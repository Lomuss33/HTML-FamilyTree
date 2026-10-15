import assert from "node:assert/strict";
import test from "node:test";
import http from "node:http";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createLocalServer } from "../scripts/local-server.mjs";
import { createProject, hashes, PASSWORD } from "./helpers/project.mjs";
import { createFamilyWorkflow } from "../scripts/lib/family-workflow.mjs";
import { encryptedPayloadDigest } from "../scripts/lib/public-bytes.mjs";
import { decryptFamily } from "../scripts/lib/family-crypto.mjs";
import { readFile } from "node:fs/promises";

async function running(t, options = {}) {
  const project = await createProject(t, { site: true });
  const messages = [];
  const application = await createLocalServer({ root: project.paths.root, logger: { error: message => messages.push(message) }, ...options });
  await new Promise(resolve => application.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    application.server.closeAllConnections();
    await new Promise(resolve => application.server.close(resolve));
  });
  const origin = "http://127.0.0.1:" + application.server.address().port;
  const status = await (await fetch(origin + "/api/status")).json();
  return { ...project, ...application, origin, status, messages };
}

async function rawRequest(origin, requestPath, { method = "GET", headers = {}, body } = {}) {
  const url = new URL(origin);
  return new Promise((resolve, reject) => {
    const request = http.request({ hostname: url.hostname, port: url.port, path: requestPath, method, headers }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.on("end", () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString("utf8") }));
    });
    request.on("error", reject);
    request.end(body);
  });
}

test("only manifest files are served; private/repository/encoded paths fail for GET and HEAD", async t => {
  const app = await running(t);
  await mkdir(path.join(app.paths.root, ".git"), { recursive: true });
  await writeFile(path.join(app.paths.root, ".git/HEAD"), "fictional-canary");
  const home = await rawRequest(app.origin, "/");
  assert.equal(home.status, 200);
  assert.equal(home.headers["x-content-type-options"], "nosniff");
  const head = await rawRequest(app.origin, "/assets/app.js", { method: "HEAD" });
  assert.equal(head.status, 200);
  assert.equal(head.body, "");
  assert.ok(Number(head.headers["content-length"]) > 0);
  for (const file of ["/private/family.json", "/data/family.private.json", "/private/backups/test.json",
    "/.git/HEAD", "/.aws-sam/template.yaml", "/api/src/admin-suggestions.mjs",
    "/api/generated/canonical-revision.json", "/scripts/local-server.mjs",
    "/%2e%2e/private/family.json", "/..%5cprivate/family.json", "/C:%5cWindows", "/assets/"]) {
    for (const method of ["GET", "HEAD"]) {
      const response = await rawRequest(app.origin, file, { method });
      assert.ok(response.status >= 400, method + " must reject " + file);
      assert.equal(response.body.includes("fictional-canary"), false);
    }
  }
});

test("Host, Origin, content type, token and unknown fields reject writes before changes", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  const headers = { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": app.status.csrfToken };
  const body = JSON.stringify({ password: PASSWORD, payloadDigest: app.status.payloadDigest });
  for (const [extra, expected] of [
    [{ Origin: "https://untrusted.example" }, 403],
    [{ Origin: "null" }, 403],
    [{ Origin: "" }, 403],
    [{ "X-Family-Local-Token": "" }, 403],
    [{ "X-Family-Local-Token": "wrong" }, 403],
    [{ "Content-Type": "text/plain" }, 415],
    [{ "Sec-Fetch-Site": "cross-site" }, 403],
    [{ Host: "localhost.example:" + app.server.address().port }, 403]
  ]) {
    const response = await rawRequest(app.origin, "/api/session", { method: "POST", headers: { ...headers, ...extra }, body });
    assert.equal(response.status, expected);
  }
  const unsupported = await rawRequest(app.origin, "/api/save", { method: "POST", headers,
    body: JSON.stringify({ approvePublication: true }) });
  assert.equal(unsupported.status, 400);
  assert.deepEqual(await hashes(app.paths), before);
});

test("body bounds and malformed JSON return useful safe errors", async t => {
  const app = await running(t, { maxBodyBytes: 128 });
  const headers = { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": app.status.csrfToken };
  for (const [body, status] of [["{", 400], [JSON.stringify({ password: "x".repeat(300) }), 413],
    [JSON.stringify({ password: "ž".repeat(100) }), 413]]) {
    const result = await rawRequest(app.origin, "/api/session", { method: "POST", headers, body });
    assert.equal(result.status, status);
    assert.equal(result.body.includes(PASSWORD), false);
  }
  assert.deepEqual(app.messages, []);
});

test("protected session/save/receipt update real files and served ciphertext together", async t => {
  const app = await running(t);
  const headers = { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": app.status.csrfToken };
  const session = await rawRequest(app.origin, "/api/session", { method: "POST", headers,
    body: JSON.stringify({ password: PASSWORD, payloadDigest: app.status.payloadDigest }) });
  assert.equal(session.status, 200);
  const snapshot = JSON.parse(session.body);
  snapshot.nodes[0].data.birthday = "Fictional new date";
  const request = { nodes: snapshot.nodes, password: PASSWORD, expectedRevision: snapshot.privateRevision,
    snapshotId: snapshot.snapshotId, operationId: "fictional-http-operation" };
  const result = await rawRequest(app.origin, "/api/save", { method: "POST", headers, body: JSON.stringify(request) });
  assert.equal(result.status, 200);
  const saved = JSON.parse(result.body);
  assert.equal(saved.ok, true);
  assert.notEqual(saved.payloadDigest, snapshot.payloadDigest);
  const receipt = await rawRequest(app.origin, "/api/operations/" + request.operationId, { headers });
  assert.equal(JSON.parse(receipt.body).state, "committed");
  const stale = await rawRequest(app.origin, "/api/save", { method: "POST", headers,
    body: JSON.stringify({ ...request, operationId: "fictional-stale-operation" }) });
  assert.equal(stale.status, 409);
});

test("invalid family responses report counts without exposing record values", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  app.nodes[0].id = "fictional-private-response-canary";
  app.nodes[0].rels.parents = null;
  const response = await rawRequest(app.origin, "/api/save", { method: "POST",
    headers: { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": app.status.csrfToken },
    body: JSON.stringify({ nodes: app.nodes, password: PASSWORD, operationId: "fictional-invalid-family",
      expectedRevision: app.status.privateRevision, snapshotId: app.status.snapshotId }) });
  assert.equal(response.status, 400);
  assert.ok(JSON.parse(response.body).issueCount > 0);
  assert.equal(response.body.includes("fictional-private-response-canary"), false);
  assert.deepEqual(await hashes(app.paths), before);
});

test("a maintenance save refreshes the served edition before a new browser session opens", async t => {
  const app = await running(t);
  const workflow = createFamilyWorkflow(app.paths);
  const old = await workflow.snapshot();
  app.nodes[0].data.birthday = "Fictional maintenance correction";
  await workflow.save({ nodes: app.nodes, password: PASSWORD, expectedRevision: old.privateRevision,
    snapshotId: old.snapshotId, operationId: "fictional-maintenance-save" });
  const status = await (await fetch(app.origin + "/api/status")).json();
  const served = await (await fetch(app.origin + "/data/family.enc.json")).text();
  assert.equal(encryptedPayloadDigest(served), status.payloadDigest);
  assert.notEqual(status.payloadDigest, app.status.payloadDigest);
  const response = await rawRequest(app.origin, "/api/session", { method: "POST",
    headers: { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": status.csrfToken },
    body: JSON.stringify({ password: PASSWORD, payloadDigest: status.payloadDigest }) });
  assert.equal(response.status, 200);
  assert.deepEqual(JSON.parse(response.body).nodes, app.nodes);
});

test("a failed HTTP save retains the previous five files and served viewer, then permits a successful retry", async t => {
  let failOnce = true;
  const app = await running(t, { fault: async point => {
    if (failOnce && point === "after:encrypted") { failOnce = false; throw new Error("Fictional disk failure"); }
  } });
  const before = await hashes(app.paths);
  app.nodes[0].data.birthday = "Fictional retry date";
  const request = { nodes: app.nodes, password: PASSWORD, expectedRevision: app.status.privateRevision,
    snapshotId: app.status.snapshotId, operationId: "fictional-failed-http-save" };
  const headers = { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": app.status.csrfToken };
  const failed = await rawRequest(app.origin, "/api/save", { method: "POST", headers, body: JSON.stringify(request) });
  assert.equal(failed.status, 500);
  assert.equal(JSON.parse(failed.body).code, "SAVE_FAILED");
  assert.deepEqual(await hashes(app.paths), before);
  assert.equal(encryptedPayloadDigest(await (await fetch(app.origin + "/data/family.enc.json")).text()), app.status.payloadDigest);
  const succeeded = await rawRequest(app.origin, "/api/save", { method: "POST", headers,
    body: JSON.stringify({ ...request, operationId: "fictional-retried-http-save" }) });
  assert.equal(succeeded.status, 200);
  assert.equal(JSON.parse(succeeded.body).ok, true);
  assert.deepEqual(await decryptFamily(JSON.parse(await readFile(app.paths.encrypted, "utf8")), PASSWORD), app.nodes);
});

test("concurrent sessions cannot commit two conflicting saves from the same snapshot", async t => {
  const app = await running(t);
  const headers = { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": app.status.csrfToken };
  const requests = ["Fictional first edit", "Fictional second edit"].map((value, index) => {
    const nodes = structuredClone(app.nodes);
    nodes[0].data.birthday = value;
    return { nodes, password: PASSWORD, expectedRevision: app.status.privateRevision,
      snapshotId: app.status.snapshotId, operationId: "fictional-concurrent-save-" + index };
  });
  const results = await Promise.all(requests.map(body => rawRequest(app.origin, "/api/save",
    { method: "POST", headers, body: JSON.stringify(body) })));
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const winner = results.findIndex(result => result.status === 200);
  const loser = 1 - winner;
  const committed = await hashes(app.paths);
  const stale = await rawRequest(app.origin, "/api/save", { method: "POST", headers, body: JSON.stringify(requests[loser]) });
  assert.equal(stale.status, 409);
  assert.equal(JSON.parse(stale.body).code, "STALE_SNAPSHOT");
  assert.deepEqual(await hashes(app.paths), committed);
  assert.deepEqual(await decryptFamily(JSON.parse(await readFile(app.paths.encrypted, "utf8")), PASSWORD), requests[winner].nodes);
});

test("an aborted body and invalid UTF-8 cannot write files or stop the local server", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  const headers = { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": app.status.csrfToken };
  const observedAbort = new Promise(resolve => app.server.once("request", request => request.once("aborted", resolve)));
  const url = new URL(app.origin);
  const request = http.request({ hostname: url.hostname, port: url.port, path: "/api/save", method: "POST",
    headers: { ...headers, "Content-Length": 1000 } });
  request.on("error", () => {});
  const arrived = new Promise(resolve => app.server.once("request", resolve));
  request.write('{"nodes":');
  await arrived;
  request.destroy();
  await observedAbort;
  const invalid = await rawRequest(app.origin, "/api/save", { method: "POST", headers,
    body: Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d]) });
  assert.equal(invalid.status, 400);
  assert.equal((await fetch(app.origin + "/api/status")).status, 200);
  assert.deepEqual(await hashes(app.paths), before);
  assert.deepEqual(app.messages, []);
});
