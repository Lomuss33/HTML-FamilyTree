import http from "node:http";
import path from "node:path";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { pathToFileURL } from "node:url";
import { projectPaths, parseArgs, FamilyWorkflowError, fileExists } from "./lib/project-paths.mjs";
import { createFamilyWorkflow } from "./lib/family-workflow.mjs";
import { recoverTransactions } from "./lib/file-transaction.mjs";
import { buildSite, loadSiteBuffers } from "./lib/publication.mjs";
import { encryptedPayloadDigest } from "./lib/public-bytes.mjs";

const mimeTypes = new Map([
  [".html", "text/html; charset=utf-8"], [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"], [".json", "application/json; charset=utf-8"],
  [".svg", "image/svg+xml"], [".png", "image/png"]
]);

export async function createLocalServer({ root, environment = "local", runtimeConfig, logger = console,
  maxBodyBytes = 2 * 1024 * 1024, workflow: injectedWorkflow, fault } = {}) {
  const paths = projectPaths(root);
  const token = randomBytes(32).toString("base64url");
  const workflow = injectedWorkflow ?? createFamilyWorkflow(paths, { fault });
  let blocked;
  let site;
  try { await recoverTransactions(paths); } catch (error) { blocked = error; }
  async function refreshSite() {
    await buildSite(paths, { environment, runtimeConfig });
    site = await loadSiteBuffers(paths);
  }
  if (blocked && await fileExists(paths.dist)) site = await loadSiteBuffers(paths);
  else await refreshSite();

  const server = http.createServer((request, response) => {
    void handle(request, response).catch(error => {
      if (response.writableEnded || response.destroyed) return;
      const known = error instanceof FamilyWorkflowError;
      if (!known) logger.error?.({ code: "LOCAL_REQUEST_FAILED" });
      sendJson(response, known ? error.status : 500, {
        ok: false, code: known ? error.code : "INTERNAL_ERROR",
        message: known ? error.message : "The local operation failed. Inspect the recovery state before retrying.",
        ...(known && error.details?.issueCount ? { issueCount: error.details.issueCount } : {})
      });
    });
  });
  server.headersTimeout = 10000;
  server.requestTimeout = 15000;

  async function handle(request, response) {
    const port = server.address()?.port;
    const hosts = new Set(["127.0.0.1:" + port, "localhost:" + port]);
    if (!hosts.has(request.headers.host)) throw new FamilyWorkflowError("INVALID_HOST", "This server accepts its exact loopback host only.", 403);
    const origin = "http://" + request.headers.host;
    const rawPath = (request.url ?? "/").split("?")[0];
    let pathname;
    try { pathname = decodeURIComponent(rawPath); }
    catch { throw new FamilyWorkflowError("INVALID_PATH", "Malformed request path."); }
    if (!pathname.startsWith("/") || pathname.includes("\\") || /[\0:]/.test(pathname)
      || pathname.split("/").some(part => part === ".." || part === ".")) {
      throw new FamilyWorkflowError("INVALID_PATH", "Forbidden request path.", 403);
    }
    const api = pathname.startsWith("/api/");
    if (api && request.headers.origin && request.headers.origin !== origin) throw new FamilyWorkflowError("INVALID_ORIGIN", "Only the local application may use this API.", 403);
    if (api && request.headers["sec-fetch-site"] === "cross-site") throw new FamilyWorkflowError("INVALID_ORIGIN", "Cross-site API requests are not allowed.", 403);
    if (request.method === "GET" && pathname === "/api/status") {
      try {
        if (blocked) throw blocked;
        let { nodes: _nodes, ...snapshot } = await workflow.snapshot();
        if (encryptedPayloadDigest(site.get("/data/family.enc.json").toString("utf8")) !== snapshot.payloadDigest) {
          await refreshSite();
          ({ nodes: _nodes, ...snapshot } = await workflow.snapshot());
        }
        return sendJson(response, 200, { protocolVersion: 2, localSave: true, csrfToken: token, ...snapshot });
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
    if (request.method === "POST" && ["/api/session", "/api/save"].includes(pathname)) {
      if (request.headers.origin !== origin) throw new FamilyWorkflowError("INVALID_ORIGIN", "An exact local Origin is required.", 403);
      if (!/^application\/json(?:;\s*charset=utf-8)?$/i.test(request.headers["content-type"] ?? "")) throw new FamilyWorkflowError("JSON_REQUIRED", "Send UTF-8 JSON.", 415);
      requireToken(request);
      if (blocked) throw blocked;
      const body = await readJsonBody(request, maxBodyBytes);
      const allowed = pathname === "/api/session" ? ["password", "payloadDigest"] :
        ["nodes", "password", "expectedRevision", "snapshotId", "operationId", "publicationApprovalToken"];
      if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) {
        throw new FamilyWorkflowError("INVALID_REQUEST", "The local request contains unsupported fields.");
      }
      if (pathname === "/api/session") return sendJson(response, 200, { ok: true, ...await workflow.openSnapshot(body) });
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
    const buffer = site.get(relative);
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

  return { server, paths, workflow, refreshSite };
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
    const { server } = await createLocalServer({ root: options.root, environment: options.environment ?? "local" });
    const port = Number(options.port ?? process.env.PORT ?? 4173);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new FamilyWorkflowError("INVALID_PORT", "Choose a local port from 1 to 65535.");
    server.once("error", error => {
      console.error(error.code === "EADDRINUSE" ? "PORT_IN_USE: Choose another port with npm run local -- --port 4174."
        : "LOCAL_START_FAILED: The loopback server could not start.");
      process.exitCode = 1;
    });
    server.listen(port, "127.0.0.1", () => {
      console.log("Local family tree: http://127.0.0.1:" + server.address().port);
    });
  } catch (error) {
    console.error(error.code ?? "LOCAL_START_FAILED", "Local startup stopped. Check migration, recovery, and public build inputs.");
    process.exitCode = 1;
  }
}
