import http from "node:http";
import https from "node:https";
import { isIPv4 } from "node:net";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { projectPaths, parseArgs, FamilyWorkflowError, fileExists } from "./lib/project-paths.mjs";
import { createFamilyWorkflow } from "./lib/family-workflow.mjs";
import { recoverTransactions } from "./lib/file-transaction.mjs";
import { buildSite, loadSiteBuffers, PUBLIC_OUTPUT_FILES } from "./lib/publication.mjs";
import { encryptedPayloadDigest } from "./lib/public-bytes.mjs";
import { createMediaStore } from "./lib/media-store.mjs";
import { MAX_IMAGE_BYTES } from "../assets/viewer/media-data.js";
import { createLocalSuggestions } from "./lib/local-suggestions.mjs";
import { validateHomelabConfig, homelabPage } from "./lib/homelab-access.mjs";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"]
]);

export async function createLocalServer({ root, environment = "local", runtimeConfig, logger = console,
  maxBodyBytes = 2 * 1024 * 1024, workflow: injectedWorkflow, fault, host = "127.0.0.1", tls, homelab } = {}) {
  if (homelab) {
    homelab = validateHomelabConfig(homelab);
    if (host !== "127.0.0.1" || tls) throw new FamilyWorkflowError("INVALID_HOMELAB_BIND", "Homelab backends must use loopback HTTP behind their separate HTTPS proxies.");
    // Homelab suggestions and review use the local queue, never production AWS.
    runtimeConfig = {};
  }
  if (!isIPv4(host) || host === "0.0.0.0" || host === "255.255.255.255") {
    throw new FamilyWorkflowError("INVALID_BIND_HOST", "Choose an exact local IPv4 address for --host.");
  }
  if (!host.startsWith("127.") && (!tls?.cert || !tls?.key)) {
    throw new FamilyWorkflowError("HTTPS_REQUIRED", "Network access requires HTTPS. Supply --cert and --key for this computer.");
  }
  const protocol = tls ? "https:" : "http:";
  const paths = projectPaths(root);
  const token = randomBytes(32).toString("base64url");
  const workflow = injectedWorkflow ?? createFamilyWorkflow(paths, { fault });
  const media = createMediaStore(paths);
  const suggestions = createLocalSuggestions(paths, { logger });
  const submissions = new Map();
  let blocked;
  let site;
  let publicSite;
  try { await recoverTransactions(paths); } catch (error) { blocked = error; }
  async function refreshSite() {
    await buildSite(paths, { environment, runtimeConfig });
    site = await loadSiteBuffers(paths);
    prepareAccessViews();
  }
  function prepareAccessViews() {
    if (!homelab) return;
    publicSite = new Map(PUBLIC_OUTPUT_FILES.filter(file => file !== "data/family.enc.json")
      .map(file => ["/" + file, site.get("/" + file)]));
    publicSite.set("/index.html", homelabPage(site.get("/index.html"), "public"));
    site.set("/index.html", homelabPage(site.get("/index.html"), "private"));
    // No cloud configuration may leak back in when starting from recovery output.
    const config = Buffer.from("window.FAMILY_TREE_CONFIG = Object.freeze({suggestionsApiUrl:'',adminApiUrl:'',adminAuth:null});\n");
    site.set("/assets/site-config.js", config);
    publicSite.set("/assets/site-config.js", config);
  }
  if (blocked && await fileExists(paths.dist)) { site = await loadSiteBuffers(paths); prepareAccessViews(); }
  else await refreshSite();

  const onRequest = access => (request, response) => {
    void handle(request, response, access).catch(error => {
      if (response.writableEnded || response.destroyed) return;
      const known = error instanceof FamilyWorkflowError;
      if (!known) logger.error?.({ code: "LOCAL_REQUEST_FAILED" });
      sendJson(response, known ? error.status : 500, {
        ok: false, code: known ? error.code : "INTERNAL_ERROR",
        message: known ? error.message : "The local operation failed. Inspect the recovery state before retrying.",
        ...(known && error.details?.issueCount ? { issueCount: error.details.issueCount } : {})
      });
    });
  };
  const privateHandler = onRequest(homelab ? "private" : "local");
  const server = tls ? https.createServer(tls, privateHandler) : http.createServer(privateHandler);
  const publicServer = homelab ? http.createServer(onRequest("public")) : null;
  for (const listener of [server, publicServer].filter(Boolean)) {
    listener.headersTimeout = 10000;
    listener.requestTimeout = 15000;
  }

  async function handle(request, response, access) {
    const isPublic = access === "public";
    const port = server.address()?.port;
    const authority = host + (port === (tls ? 443 : 80) ? "" : ":" + port);
    const hosts = new Set([authority]);
    if (host === "127.0.0.1") hosts.add("localhost" + (port === (tls ? 443 : 80) ? "" : ":" + port));
    const externalOrigin = homelab && (isPublic ? homelab.publicOrigin : homelab.privateOrigin);
    if (externalOrigin) { hosts.clear(); hosts.add(new URL(externalOrigin).host); }
    if (!hosts.has(request.headers.host)) throw new FamilyWorkflowError("INVALID_HOST", "This server accepts its exact configured host only.", 403);
    // Never trust X-Forwarded-Host/Proto or Tailscale identity headers from a caller.
    const origin = externalOrigin || protocol + "//" + request.headers.host;
    const rawPath = (request.url ?? "/").split("?")[0];
    let pathname;
    try { pathname = decodeURIComponent(rawPath); }
    catch { throw new FamilyWorkflowError("INVALID_PATH", "Malformed request path."); }
    if (!pathname.startsWith("/") || pathname.includes("\\") || /[\0:]/.test(pathname)
      || pathname.split("/").some(part => part === ".." || part === ".")) {
      throw new FamilyWorkflowError("INVALID_PATH", "Forbidden request path.", 403);
    }
    const api = pathname.startsWith("/api/");
    if (isPublic && api && !(request.method === "GET" && pathname === "/api/public-status")
      && !(request.method === "POST" && ["/api/suggestions", "/api/suggestions/photos"].includes(pathname))) {
      throw new FamilyWorkflowError("NOT_FOUND", "Not Found", 404);
    }
    if (api && request.headers.origin && request.headers.origin !== origin) throw new FamilyWorkflowError("INVALID_ORIGIN", "Only the local application may use this API.", 403);
    if (api && request.headers["sec-fetch-site"] === "cross-site") throw new FamilyWorkflowError("INVALID_ORIGIN", "Cross-site API requests are not allowed.", 403);
    if (request.method === "GET" && pathname === "/api/public-status") {
      const suggestionState = await suggestions.publicState().catch(() => ({ submissionCodeConfigured: false }));
      return sendJson(response, 200, { protocolVersion: 2, submissionCodeConfigured: !blocked && suggestionState.submissionCodeConfigured === true,
        localSuggestionPhotos: true, localProfileSuggestions: true });
    }
    if (request.method === "GET" && pathname === "/api/status") {
      try {
        if (blocked) throw blocked;
        let { nodes: _nodes, ...snapshot } = await workflow.snapshot();
        if (encryptedPayloadDigest(site.get("/data/family.enc.json").toString("utf8")) !== snapshot.payloadDigest) {
          await refreshSite();
          ({ nodes: _nodes, ...snapshot } = await workflow.snapshot());
        }
        const suggestionState = await suggestions.publicState().catch(() => ({ submissionCodeConfigured: false }));
        return sendJson(response, 200, { protocolVersion: 2, localSave: true, csrfToken: token, ...snapshot,
          localSuggestions: true, localSuggestionPhotos: true, localProfileSuggestions: true, ...suggestionState });
      } catch (error) {
        return sendJson(response, 200, { protocolVersion: 2, localSave: false,
          code: error.code ?? "LOCAL_UNAVAILABLE", message: "Local saving needs migration or recovery. Check the maintainer instructions." });
      }
    }
    if (request.method === "GET" && pathname.startsWith("/api/operations/")) {
      requireToken(request);
      const receipt = await workflow.receipt(pathname.slice("/api/operations/".length));
      if (receipt?.result && blocked?.code === "SITE_REBUILD_REQUIRED") receipt.result.siteRefreshRequired = true;
      return sendJson(response, receipt ? 200 : 404, receipt ?? { ok: false, code: "NOT_FOUND", message: "No committed receipt was found." });
    }
    if (request.method === "POST" && ["/api/suggestions", "/api/suggestions/photos"].includes(pathname)) {
      if (request.headers.origin !== origin) throw new FamilyWorkflowError("INVALID_ORIGIN", "An exact local Origin is required.", 403);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) throw new FamilyWorkflowError("JSON_REQUIRED", "Send UTF-8 JSON.", 415);
      if (blocked) throw blocked;
      const key = request.socket.remoteAddress;
      const now = Date.now();
      for (const [address, entry] of submissions) if (entry.until <= now) submissions.delete(address);
      const entry = submissions.get(key) ?? { count: 0, until: now + 60000 };
      submissions.set(key, entry);
      if (++entry.count > 30) { request.resume(); response.setHeader("Retry-After", "60"); return sendJson(response, 429, { error: "Too many attempts" }); }
      if (pathname.endsWith("/photos")) return sendJson(response, 201,
        await suggestions.uploadPhoto(await readJsonBody(request, Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8192)));
      const result = await suggestions.submit(await readJsonBody(request, 64 * 1024));
      return sendJson(response, result.statusCode, JSON.parse(result.body));
    }
    const suggestionAdmin = ["/api/admin/suggestions/list", "/api/admin/suggestions/get", "/api/admin/suggestions/review", "/api/admin/suggestions/draft", "/api/admin/suggestions/settings", "/api/admin/suggestions/photo", "/api/admin/suggestions/photo-draft"].includes(pathname);
    if (request.method === "POST" && (["/api/session", "/api/save", "/api/media/upload", "/api/media/read"].includes(pathname) || suggestionAdmin)) {
      if (request.headers.origin !== origin) throw new FamilyWorkflowError("INVALID_ORIGIN", "An exact local Origin is required.", 403);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) throw new FamilyWorkflowError("JSON_REQUIRED", "Send UTF-8 JSON.", 415);
      requireToken(request);
      if (blocked) throw blocked;
      const body = await readJsonBody(request, pathname === "/api/media/upload" ? Math.ceil(MAX_IMAGE_BYTES / 3) * 4 + 8192 : maxBodyBytes);
      const allowed = pathname === "/api/session" ? ["password", "payloadDigest"] :
        pathname === "/api/admin/suggestions/list" ? ["password", "query"] :
        pathname === "/api/admin/suggestions/get" ? ["password", "id"] :
        pathname === "/api/admin/suggestions/review" ? ["password", "id", "review", "expectedReviewRevision", "expectedSnapshotId", "acceptedProfileFields"] :
        pathname === "/api/admin/suggestions/draft" ? ["password", "id", "expectedReviewRevision", "expectedSnapshotId"] :
        pathname === "/api/admin/suggestions/photo" ? ["password", "id", "photoId"] :
        pathname === "/api/admin/suggestions/photo-draft" ? ["password", "id", "nodes", "assignments", "expectedReviewRevision", "expectedSnapshotId"] :
        pathname === "/api/admin/suggestions/settings" ? ["password", "accessCode", "enabled"] :
        pathname === "/api/media/upload" ? ["password", "payloadDigest", "type", "content"] :
        pathname === "/api/media/read" ? ["password", "payloadDigest", "id"] :
        ["nodes", "password", "expectedRevision", "snapshotId", "operationId", "publicationApprovalToken"];
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
        throw new FamilyWorkflowError("INVALID_REQUEST", "The local request contains unsupported fields.");
      }
      if (pathname === "/api/session") return sendJson(response, 200, { ok: true, ...await workflow.openSnapshot(body) });
      if (suggestionAdmin) {
        await workflow.verifyPassword(body.password);
        if (pathname.endsWith("/photo")) {
          const { bytes, type } = await suggestions.readPhoto(body.id, body.photoId);
          response.writeHead(200, { ...safeHeaders(), "Content-Type": type, "Content-Length": bytes.length });
          return response.end(bytes);
        }
        const result = pathname.endsWith("/list") ? await suggestions.list(body.query)
          : pathname.endsWith("/get") ? await suggestions.get(body.id)
            : pathname.endsWith("/review") ? await suggestions.review(body.id, body.review, body.expectedReviewRevision, body.expectedSnapshotId, body.acceptedProfileFields)
              : pathname.endsWith("/draft") ? await suggestions.draft(body.id, body.expectedReviewRevision, body.expectedSnapshotId)
              : pathname.endsWith("/photo-draft") ? await suggestions.photoDraft(body.id, body)
              : Object.hasOwn(body, "accessCode") || Object.hasOwn(body, "enabled")
                ? await suggestions.configure(body) : await suggestions.publicState();
        return sendJson(response, 200, result);
      }
      if (pathname.startsWith("/api/media/")) {
        // Media IDs address immutable bytes. Authenticate against the current
        // edition without tying an image read/upload to an old editor snapshot.
        await workflow.verifyPassword(body.password);
        if (pathname === "/api/media/upload") return sendJson(response, 200, { ok: true, ...await media.putEncoded(body.content, body.type) });
        const { bytes, type } = await media.read(body.id);
        response.writeHead(200, { ...safeHeaders(), "Content-Type": type, "Content-Length": bytes.length });
        return response.end(bytes);
      }
      const result = await workflow.save({ ...body, operation: "save" });
      if (result.ok) {
        try { await refreshSite(); }
        catch {
          blocked = new FamilyWorkflowError("SITE_REBUILD_REQUIRED", "Files were saved, but site rebuilding needs attention.", 503);
          return sendJson(response, 200, { ...result, siteRefreshRequired: true });
        }
      }
      return sendJson(response, 200, result);
    }
    if (api) throw new FamilyWorkflowError("METHOD_NOT_ALLOWED", "Unknown API route or method.", 405);
    if (!["GET", "HEAD"].includes(request.method)) throw new FamilyWorkflowError("METHOD_NOT_ALLOWED", "Only GET and HEAD are supported.", 405);
    const relative = pathname === "/" ? "/index.html" : pathname;
    const buffer = (isPublic ? publicSite : site).get(relative);
    if (!buffer) throw new FamilyWorkflowError("NOT_FOUND", "Not Found", 404);
    response.writeHead(200, {
      ...safeHeaders(), "Content-Type": mimeTypes.get(path.extname(relative)) ?? "application/octet-stream",
      "Content-Length": buffer.length
    });
    response.end(request.method === "HEAD" ? undefined : buffer);
  }

  function requireToken(request) {
    const received = Buffer.from(typeof request.headers["x-family-local-token"] === "string" ? request.headers["x-family-local-token"] : "");
    const expected = Buffer.from(token);
    if (received.length !== expected.length || !timingSafeEqual(received, expected)) throw new FamilyWorkflowError("INVALID_TOKEN", "Refresh the local application before saving.", 403);
  }

  return { server, publicServer, paths, workflow, refreshSite };
}

function readJsonBody(request, maximum) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    let finished = false;
    function finish(error, result) {
      if (finished) return;
      finished = true;
      request.off("data", onData);
      request.off("end", onEnd);
      request.off("aborted", onAbort);
      // Keep the harmless error listener until the stream closes, including rejected bodies.
      if (error) { request.resume(); reject(error); } else resolve(result);
    }
    const onData = chunk => {
      size += chunk.length;
      if (size > maximum) return finish(new FamilyWorkflowError("PAYLOAD_TOO_LARGE", "The local request is too large.", 413));
      chunks.push(chunk);
    };
    const onEnd = () => {
      try { finish(null, JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)))); }
      catch { finish(new FamilyWorkflowError("INVALID_JSON", "The request is not valid JSON.")); }
    };
    const onAbort = () => finish(new FamilyWorkflowError("REQUEST_ABORTED", "The request was interrupted."));
    const onError = () => finish(new FamilyWorkflowError("REQUEST_FAILED", "The request could not be read."));
    request.on("data", onData);
    request.once("end", onEnd);
    request.once("aborted", onAbort);
    request.once("error", onError);
    if (Number(request.headers["content-length"]) > maximum) finish(new FamilyWorkflowError("PAYLOAD_TOO_LARGE", "The local request is too large.", 413));
  });
}

function safeHeaders() {
  return { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin", "Referrer-Policy": "no-referrer" };
}

function sendJson(response, status, payload) {
  response.writeHead(status, { ...safeHeaders(), "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(payload) + "\n");
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const host = options.host ?? "127.0.0.1";
    if (Boolean(options.cert) !== Boolean(options.key)) throw new FamilyWorkflowError("TLS_FILES_REQUIRED", "Supply both --cert and --key.");
    const tls = options.cert ? { cert: await readFile(options.cert), key: await readFile(options.key) } : undefined;
    const port = Number(options.port ?? process.env.PORT ?? 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new FamilyWorkflowError("INVALID_PORT", "Choose a local port from 1 to 65535.");
    const { server } = await createLocalServer({ root: options.root, environment: options.environment ?? "local", host, tls });
    server.once("error", error => {
      console.error(error.code === "EADDRINUSE" ? "PORT_IN_USE: Choose another port with npm run local -- --port 4174."
        : "LOCAL_START_FAILED: The local server could not start.");
      process.exitCode = 1;
    });
    server.listen(port, host, () => {
      console.log("Local family tree: " + (tls ? "https://" : "http://") + host + ":" + server.address().port);
    });
  } catch (error) {
    console.error(error.code ?? "LOCAL_START_FAILED", error instanceof FamilyWorkflowError ? error.message
      : "Local startup stopped. Check TLS files, migration, recovery, and public build inputs.");
    process.exitCode = 1;
  }
}
