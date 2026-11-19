import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { REPOSITORY_ROOT } from "../scripts/lib/project-paths.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
import { startHomelab } from "../scripts/homelab-server.mjs";
import { validateHomelabConfig } from "../scripts/lib/homelab-access.mjs";
import { createProject, hashes, PASSWORD } from "./helpers/project.mjs";
import { decryptFamily } from "../scripts/lib/family-crypto.mjs";
import { supportsLocalEditing } from "../assets/editor/local-api.js";
import { PNG } from "./helpers/photos.mjs";

const CONFIG = { publicOrigin: "https://fictional.example.ts.net", privateOrigin: "https://fictional.example.ts.net:8443",
  publicPort: 4180, privatePort: 4181 };
const CODE = "fictional-homelab-guest-code";

async function running(t, options = {}) {
  const project = await createProject(t, { site: true });
  const messages = [];
  const app = await createLocalServer({ root: project.paths.root, homelab: CONFIG,
    logger: { error: value => messages.push(value) }, ...options });
  for (const server of [app.server, app.publicServer]) {
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  }
  async function request(access, route, { method = "GET", body, headers = {} } = {}) {
    const server = access === "public" ? app.publicServer : app.server;
    const origin = access === "public" ? CONFIG.publicOrigin : CONFIG.privateOrigin;
    return await new Promise((resolve, reject) => {
      const req = http.request({ hostname: "127.0.0.1", port: server.address().port, method, path: route,
        headers: { Host: new URL(origin).host, ...(body === undefined ? {} : { Origin: origin, "Content-Type": "application/json" }), ...headers } }, res => {
        const chunks = [];
        res.on("data", chunk => chunks.push(chunk));
        res.on("end", () => {
          const bytes = Buffer.concat(chunks);
          const text = bytes.toString("utf8");
          resolve({ status: res.statusCode, headers: res.headers, bytes, text,
            body: res.headers["content-type"]?.includes("application/json") && text ? JSON.parse(text) : null });
        });
      });
      req.on("error", reject);
      req.end(body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body));
    });
  }
  const status = (await request("private", "/api/status")).body;
  const owner = (route, body, headers) => request("private", route,
    { method: "POST", body: { password: PASSWORD, ...body }, headers: { "X-Family-Local-Token": status.csrfToken, ...headers } });
  return { ...project, ...app, messages, request, status, owner };
}

test("public listener denies every private API and encrypted source even with valid owner credentials and spoofed headers", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  const publicStatus = await app.request("public", "/api/public-status");
  assert.deepEqual(publicStatus.body, { protocolVersion: 2, submissionCodeConfigured: false,
    localSuggestionPhotos: true, localProfileSuggestions: true });
  assert.equal(publicStatus.headers["cache-control"], "no-store");
  const paths = ["/api/status", "/api/session", "/api/save", "/api/operations/fictional-operation",
    "/api/media/read", "/api/media/upload", "/api/admin/suggestions/list", "/api/admin/suggestions/settings",
    "/api/admin/suggestions/get", "/api/admin/suggestions/review", "/api/admin/suggestions/draft",
    "/api/admin/suggestions/photo", "/api/admin/suggestions/photo-draft", "/api%2fsave",
    "/data/family.enc.json", "/data/family%2eenc.json", "/data/family.enc.json?download=1",
    "/private/family.json", "/private/media/fictional.png", "/private/backups/test.json", "/.git/HEAD",
    "/scripts/homelab-server.mjs", "/config/homelab.local.json"];
  for (const route of paths) for (const method of ["GET", "HEAD", "POST", "PUT"]) {
    const result = await app.request("public", route, { method, ...(method === "POST" ? { body: { password: PASSWORD, nodes: app.nodes } } : {}),
      headers: { "X-Family-Local-Token": app.status.csrfToken, "X-Forwarded-Host": new URL(CONFIG.privateOrigin).host,
        "X-Forwarded-Proto": "https", "Tailscale-User-Login": "fictional-owner@example.test" } });
    assert.ok(result.status >= 400, method + " " + route);
    assert.equal(result.text.includes(PASSWORD), false);
    assert.equal(result.text.includes("PrivateOnlyFirst"), false);
    assert.equal(result.text.includes(app.status.csrfToken), false);
  }
  assert.equal((await app.request("private", "/data/family.enc.json")).status, 200);
  const publicHome = await app.request("public", "/");
  assert.equal(publicHome.status, 200);
  assert.ok(publicHome.text.includes('data-family-access="public"'));
  assert.ok(publicHome.text.includes('id="admin-entry" hidden inert'));
  assert.ok((await app.request("private", "/")).text.includes('data-family-access="private"'));
  assert.deepEqual(await hashes(app.paths), before);
  assert.deepEqual(app.messages, []);
});

test("each listener accepts only its configured Host and exact HTTPS Origin, ignoring forwarded authority", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  for (const access of ["public", "private"]) {
    for (const Host of ["127.0.0.1:" + app.server.address().port, "untrusted.example", new URL(access === "public" ? CONFIG.privateOrigin : CONFIG.publicOrigin).host]) {
      assert.equal((await app.request(access, "/", { headers: { Host, "X-Forwarded-Host": new URL(CONFIG[access + "Origin"]).host } })).status, 403);
    }
  }
  for (const Origin of ["", "null", CONFIG.publicOrigin, "http://fictional.example.ts.net:8443", "https://untrusted.example"]) {
    const result = await app.owner("/api/session", { payloadDigest: app.status.payloadDigest }, { Origin });
    assert.equal(result.status, 403);
  }
  assert.equal((await app.owner("/api/session", { payloadDigest: app.status.payloadDigest, password: "incorrect-fictional" })).status, 403);
  assert.equal((await app.owner("/api/session", { payloadDigest: app.status.payloadDigest })).status, 200);
  assert.deepEqual(await hashes(app.paths), before);
});

test("public text, visual, profile and photo suggestions enter the private queue; review and photos stay private", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  assert.equal((await app.owner("/api/admin/suggestions/settings", { accessCode: CODE, enabled: true })).status, 200);
  assert.equal((await app.request("public", "/api/public-status")).body.submissionCodeConfigured, true);
  const guest = (route, body, headers) => app.request("public", route, { method: "POST", body, headers });
  const text = { schemaVersion: 1, type: "text", accessCode: CODE, submitterName: "Fictional visitor", message: "Fictional correction" };
  assert.equal((await guest("/api/suggestions", { ...text, accessCode: "incorrect-fictional-code" })).status, 403);
  for (const [headers, expected] of [[{ Origin: "" }, 403], [{ Origin: CONFIG.privateOrigin }, 403],
    [{ "Sec-Fetch-Site": "cross-site" }, 403], [{ "Content-Type": "text/plain" }, 415]]) {
    assert.equal((await guest("/api/suggestions", text, headers)).status, expected);
  }
  assert.equal((await guest("/api/suggestions", "{")).status, 400);
  assert.equal((await guest("/api/suggestions", { ...text, message: "x".repeat(65536) })).status, 413);
  const upload = await guest("/api/suggestions/photos", { accessCode: CODE, name: "fictional.png", type: "image/png", content: PNG.toString("base64") });
  assert.equal(upload.status, 201);
  const sent = await guest("/api/suggestions", { ...text, photoTokens: [{ token: upload.body.token, caption: "Fictional photograph" }] });
  assert.equal(sent.status, 201);
  const graph = await guest("/api/suggestions", { ...text, type: "graph", message: undefined,
    anchorPersonId: "approved-anchor", anchorCatalogVersion: app.artifacts.catalog.catalogVersion,
    sourceRevision: app.artifacts.catalog.sourceRevision, people: [{ id: "tmp_1", firstName: "Fictional child", lastName: "Example", birthday: "", gender: "F" }],
    relationships: [{ from: "approved-anchor", to: "tmp_1", type: "parentOf" }] });
  assert.equal(graph.status, 201);
  assert.equal((await guest("/api/suggestions", { ...text, profileChange: { personId: "approved-anchor",
    catalogVersion: app.artifacts.catalog.catalogVersion, changes: { birthday: "1902" } } })).status, 201);
  const loaded = await app.owner("/api/admin/suggestions/get", { id: sent.body.id });
  assert.equal(loaded.status, 200);
  const photo = loaded.body.suggestion.attachments[0];
  assert.equal((await app.request("public", "/api/admin/suggestions/photo", { method: "POST",
    body: { password: PASSWORD, id: sent.body.id, photoId: photo.id }, headers: { "X-Family-Local-Token": app.status.csrfToken } })).status, 404);
  const viewed = await app.owner("/api/admin/suggestions/photo", { id: sent.body.id, photoId: photo.id });
  assert.deepEqual(viewed.bytes, PNG);
  assert.deepEqual(await hashes(app.paths), before);
});

test("reviewed private Save refreshes the public catalog in the same process and preserves encryption compatibility", async t => {
  const app = await running(t, { runtimeConfig: { suggestionsApiUrl: "https://must-not-contact.example", adminApiUrl: "", adminAuth: null } });
  assert.equal((await app.request("public", "/assets/site-config.js")).text.includes("must-not-contact"), false);
  const opened = await app.owner("/api/session", { payloadDigest: app.status.payloadDigest });
  const snapshot = opened.body;
  snapshot.nodes[0].privacy.publicLabel = "Fictional newly reviewed label";
  const request = { nodes: snapshot.nodes, expectedRevision: snapshot.privateRevision,
    snapshotId: snapshot.snapshotId, operationId: "fictional-homelab-reviewed-save" };
  const before = await app.request("public", "/data/family.anchors.public.json");
  const review = await app.owner("/api/save", request);
  assert.equal(review.body.code, "PUBLICATION_REVIEW");
  assert.equal((await app.request("public", "/data/family.anchors.public.json")).text, before.text);
  const saved = await app.owner("/api/save", { ...request, publicationApprovalToken: review.body.approvalToken });
  assert.equal(saved.body.ok, true);
  const catalog = await app.request("public", "/data/family.anchors.public.json");
  assert.equal(catalog.body.anchors[0].displayLabel, "Fictional newly reviewed label");
  assert.equal((await app.request("private", "/data/family.anchors.public.json")).text, catalog.text);
  assert.equal((await app.request("public", "/data/family.enc.json")).status, 404);
  const encrypted = (await app.request("private", "/data/family.enc.json")).body;
  assert.deepEqual(await decryptFamily(encrypted, PASSWORD), snapshot.nodes);
  assert.deepEqual(JSON.parse(await readFile(app.paths.canonical, "utf8")), snapshot.nodes);
});

test("failed homelab Save leaves both views and all five files unchanged, with a successful retry", async t => {
  let fail = true;
  const app = await running(t, { fault: async point => {
    if (fail && point === "after:encrypted") { fail = false; throw new Error("Fictional homelab disk failure"); }
  } });
  const before = await hashes(app.paths);
  const catalog = (await app.request("public", "/data/family.anchors.public.json")).text;
  app.nodes[0].data.birthday = "Fictional corrected date";
  const request = { nodes: app.nodes, expectedRevision: app.status.privateRevision,
    snapshotId: app.status.snapshotId, operationId: "fictional-homelab-failed-save" };
  assert.equal((await app.owner("/api/save", request)).body.code, "SAVE_FAILED");
  assert.deepEqual(await hashes(app.paths), before);
  assert.equal((await app.request("public", "/data/family.anchors.public.json")).text, catalog);
  assert.equal((await app.owner("/api/save", { ...request, operationId: "fictional-homelab-retried-save" })).body.ok, true);
  assert.deepEqual(await decryptFamily((await app.request("private", "/data/family.enc.json")).body, PASSWORD), app.nodes);
});

test("homelab configuration refuses overlapping origins or ports, unsafe origins and network backend binding", async () => {
  for (const changes of [{ publicOrigin: CONFIG.privateOrigin }, { publicPort: CONFIG.privatePort }, { publicPort: 80 },
    { privatePort: "4181" }, { publicOrigin: "http://example.test" }, { privateOrigin: "https://example.test/admin" },
    { privateOrigin: "https://example.test/" }, { privateOrigin: "https://owner:password@example.test" }, { extra: true }]) {
    assert.throws(() => validateHomelabConfig({ ...CONFIG, ...changes }), { code: "INVALID_HOMELAB_CONFIG" });
  }
  await assert.rejects(createLocalServer({ homelab: CONFIG, host: "100.100.100.100" }), { code: "INVALID_HOMELAB_BIND" });
  const location = { protocol: "https:", hostname: "fictional.example.ts.net" };
  assert.equal(supportsLocalEditing(location), false);
  assert.equal(supportsLocalEditing(location, { access: "private" }), true);
  assert.equal(supportsLocalEditing({ ...location, protocol: "http:" }, { access: "private" }), false);
  assert.equal(supportsLocalEditing({ protocol: "http:", hostname: "127.0.0.1" }, { access: "public" }), false);
});

test("launcher closes its private listener if the public port is occupied", async t => {
  const project = await createProject(t, { site: true });
  const occupied = http.createServer();
  const probe = http.createServer();
  await new Promise(resolve => occupied.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise(resolve => occupied.close(resolve)));
  await new Promise(resolve => probe.listen(0, "127.0.0.1", resolve));
  const config = { ...CONFIG, publicPort: occupied.address().port, privatePort: probe.address().port };
  await new Promise(resolve => probe.close(resolve));
  await assert.rejects(startHomelab({ root: project.paths.root, config }), { code: "EADDRINUSE" });
  await new Promise((resolve, reject) => { probe.once("error", reject); probe.listen(config.privatePort, "127.0.0.1", resolve); });
  assert.equal(probe.address().address, "127.0.0.1");
  await new Promise(resolve => probe.close(resolve));
});

test("the real CLI accepts a config path with spaces and serves two loopback listeners without changing family files", { timeout: 15000 }, async t => {
  const { paths } = await createProject(t, { site: true });
  const before = await hashes(paths);
  const reservations = [http.createServer(), http.createServer()];
  for (const server of reservations) await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const config = { ...CONFIG, publicPort: reservations[0].address().port, privatePort: reservations[1].address().port };
  for (const server of reservations) await new Promise(resolve => server.close(resolve));
  const file = path.join(paths.root, "fictional homelab config.json");
  await writeFile(file, JSON.stringify(config));
  const child = spawn(process.execPath, [path.join(REPOSITORY_ROOT, "scripts/homelab-server.mjs"), "--root", paths.root, "--config", file],
    { cwd: REPOSITORY_ROOT, windowsHide: true, env: { ...process.env, FAMILY_TREE_PASSWORD: "", FAMILY_TREE_NEW_PASSWORD: "" }, stdio: ["ignore", "pipe", "pipe"] });
  const exited = once(child, "exit");
  let output = "";
  let errors = "";
  child.stderr.on("data", chunk => { errors += chunk; });
  try {
    await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => reject(new Error("Fictional CLI exited before startup.")));
      child.stdout.on("data", chunk => { output += chunk; if (output.includes("Homelab backends ready")) resolve(); });
    });
    for (const [port, origin, expected] of [[config.publicPort, config.publicOrigin, 404], [config.privatePort, config.privateOrigin, 200]]) {
      const status = await new Promise((resolve, reject) => {
        const request = http.get({ hostname: "127.0.0.1", port, path: "/data/family.enc.json", headers: { Host: new URL(origin).host } }, response => {
          response.resume(); response.on("end", () => resolve(response.statusCode));
        });
        request.on("error", reject);
      });
      assert.equal(status, expected);
    }
    assert.equal(errors, "");
    assert.equal(output.includes(PASSWORD), false);
    assert.deepEqual(await hashes(paths), before);
  } finally {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGTERM");
    await exited;
  }
});
