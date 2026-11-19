import assert from "node:assert/strict";
import test from "node:test";
import { readFile, readdir, unlink, writeFile } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { createLocalServer } from "../scripts/local-server.mjs";
import { createProject, fixture, hashes, PASSWORD } from "./helpers/project.mjs";
import { decryptFamily } from "../scripts/lib/family-crypto.mjs";
import { fileExists } from "../scripts/lib/project-paths.mjs";
import { PNG } from "./helpers/photos.mjs";

const CODE = "fictional-suggestion-code-only";
const ROTATED_CODE = "fictional-replacement-code-only";
const text = (extra = {}) => ({ schemaVersion: 1, type: "text", accessCode: CODE,
  submitterName: "Fictional visitor", message: "Fictional missing ancestor", ...extra });
const graph = (artifacts, extra = {}) => ({ schemaVersion: 1, type: "graph", accessCode: CODE,
  anchorPersonId: "approved-anchor", anchorCatalogVersion: artifacts.revision.catalogVersion,
  sourceRevision: artifacts.revision.sourceRevision, submitterName: "Fictional graph visitor",
  people: [{ id: "tmp_1", firstName: "Fictional child", lastName: "Example", birthday: "2000", gender: "F" }],
  relationships: [{ from: "approved-anchor", to: "tmp_1", type: "parentOf" }], ...extra });
const profile = (artifacts, changes = { birthday: "1902" }, extra = {}) => text({
  profileChange: { personId: "approved-anchor", catalogVersion: artifacts.revision.catalogVersion, changes }, ...extra });

test("profile proposals validate the guest code before public membership and reject arbitrary writes", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  await app.configure();
  assert.equal(app.status.localProfileSuggestions, true);
  const known = profile(app.artifacts, undefined, { accessCode: "incorrect-fictional" });
  const unknown = structuredClone(known); unknown.profileChange.personId = "private-person";
  const denied = await app.guest(known);
  assert.equal(denied.status, 403);
  assert.deepEqual((await app.guest(unknown)).body, denied.body);
  for (const change of [{ birthday: "" }, { birthday: null }, { privacy: { publicAnchor: true } }, { rels: {} }, { gallery: [] }]) {
    assert.equal((await app.guest(profile(app.artifacts, change))).status, 400);
  }
  unknown.accessCode = CODE;
  assert.equal((await app.guest(unknown)).status, 400);
  const stale = profile(app.artifacts); stale.profileChange.catalogVersion = "sha256:" + "0".repeat(64);
  assert.equal((await app.guest(stale)).status, 409);
  const uploaded = await app.post("/api/suggestions/photos", { accessCode: CODE, name: "fictional-profile.png", type: "image/png", content: PNG.toString("base64") });
  assert.equal(uploaded.status, 201);
  const submitted = await app.guest(profile(app.artifacts, { birthday: "1902" }, { photoTokens: [{ token: uploaded.body.token, caption: "Fictional source photo" }] }));
  assert.equal(submitted.status, 201);
  const { suggestion } = (await app.owner("get", { id: submitted.body.id })).body;
  assert.equal(suggestion.type, "text");
  assert.equal(suggestion.status, "pending");
  assert.equal(suggestion.attachments.length, 1);
  assert.deepEqual(suggestion.profileChange.changes, { birthday: "1902" });
  const raw = await readFile(path.join(app.directory, "records", submitted.body.id + ".json"), "utf8");
  for (const secret of [CODE, PASSWORD, uploaded.body.token]) assert.equal(raw.includes(secret), false);
  assert.equal(raw.includes("PrivateOnlyFirst"), false);
  assert.deepEqual(await hashes(app.paths), before);
});

test("owner-selected profile fields enter a draft; separate Save preserves public settings and existing history", async t => {
  const nodes = await fixture("valid-public-anchor.json");
  nodes[0].data.notes = "Fictional original source";
  nodes[0].data.residences = [{ place: "Fictional Old Town", from: "1901", to: "1910" }];
  const app = await running(t, { nodes });
  const before = await hashes(app.paths);
  await app.configure();
  const changes = { birthday: "1902", "first name": "Unselected fictional name", notes: "Fictional new source",
    residences: [{ place: "Fictional New Town", from: "1911", to: "" }] };
  const { body: { id } } = await app.guest(profile(app.artifacts, changes));
  const loaded = (await app.owner("get", { id })).body;
  const request = { id, expectedReviewRevision: loaded.reviewRevision, expectedSnapshotId: app.status.snapshotId };
  assert.equal((await app.owner("draft", request)).status, 409);
  for (const fields of [undefined, [], ["privacy"], ["birthday", "birthday"]]) {
    assert.equal((await app.owner("review", { ...request, acceptedProfileFields: fields, review: { status: "accepted" } })).status, 400);
  }
  const fields = ["birthday", "notes", "residences"];
  const accepted = await app.owner("review", { ...request, acceptedProfileFields: fields, review: { status: "accepted" } });
  assert.equal(accepted.status, 200);
  assert.deepEqual(accepted.body.suggestion.profileApproval, { fields, baseSnapshotId: app.status.snapshotId });
  const expected = structuredClone(nodes);
  expected[0].data.birthday = "1902";
  expected[0].data.notes += "\n\nFictional new source";
  expected[0].data.residences.push(changes.residences[0]);
  assert.deepEqual(accepted.body.draft.nodes, expected);
  assert.deepEqual(await hashes(app.paths), before);
  await app.restart();
  const reviewed = (await app.owner("get", { id })).body;
  assert.equal((await app.owner("draft", { ...request, expectedReviewRevision: reviewed.reviewRevision })).status, 200);
  const saved = await app.post("/api/save", { nodes: accepted.body.draft.nodes, password: PASSWORD, expectedRevision: app.status.privateRevision,
    snapshotId: app.status.snapshotId, operationId: "fictional-profile-correction-save" }, { "X-Family-Local-Token": app.status.csrfToken });
  assert.equal(saved.status, 200);
  assert.deepEqual(JSON.parse(await readFile(app.paths.canonical, "utf8")), expected);
  assert.deepEqual(await decryptFamily(JSON.parse(await readFile(app.paths.encrypted, "utf8")), PASSWORD), expected);
  const catalog = JSON.parse(await readFile(app.paths.catalog, "utf8"));
  assert.deepEqual(catalog.anchors, app.artifacts.catalog.anchors);
  assert.deepEqual(catalog.relationships, app.artifacts.catalog.relationships);
  const after = await hashes(app.paths);
  const staleDraft = await app.owner("draft", { id, expectedReviewRevision: reviewed.reviewRevision, expectedSnapshotId: saved.body.snapshotId });
  assert.equal(staleDraft.status, 409);
  assert.equal(staleDraft.body.code, "STALE_PROFILE_APPROVAL");
  assert.deepEqual(await hashes(app.paths), after);
  assert.equal((await app.owner("review", { id, expectedReviewRevision: reviewed.reviewRevision, expectedSnapshotId: saved.body.snapshotId,
    acceptedProfileFields: ["first name"], review: { status: "accepted" } })).status, 409);
  const pending = await app.owner("review", { id, expectedReviewRevision: reviewed.reviewRevision, review: { status: "pending" } });
  assert.equal(pending.status, 200);
  assert.equal(pending.body.suggestion.profileApproval, undefined);
  const reapproved = await app.owner("review", { id, expectedReviewRevision: pending.body.reviewRevision, expectedSnapshotId: saved.body.snapshotId,
    acceptedProfileFields: ["first name"], review: { status: "accepted" } });
  assert.equal(reapproved.status, 200);
  assert.equal(reapproved.body.draft.nodes[0].data["first name"], changes["first name"]);
  assert.equal(reapproved.body.draft.nodes[0].data.birthday, "1902");
  assert.deepEqual(await hashes(app.paths), after);
});

test("profile approval rejects stale private snapshots and review decisions without changing the source", async t => {
  const app = await running(t);
  await app.configure();
  const { body: { id } } = await app.guest(profile(app.artifacts));
  const { reviewRevision } = (await app.owner("get", { id })).body;
  const request = { id, expectedReviewRevision: reviewRevision, expectedSnapshotId: app.status.snapshotId,
    acceptedProfileFields: ["birthday"], review: { status: "accepted" } };
  const nodes = structuredClone(app.nodes); nodes[1].data.birthday = "Fictional newer private date";
  const saved = await app.post("/api/save", { nodes, password: PASSWORD, expectedRevision: app.status.privateRevision,
    snapshotId: app.status.snapshotId, operationId: "fictional-before-profile-review" }, { "X-Family-Local-Token": app.status.csrfToken });
  assert.equal(saved.status, 200);
  const before = await hashes(app.paths);
  const stale = await app.owner("review", request);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "STALE_SNAPSHOT");
  assert.equal((await app.owner("get", { id })).body.suggestion.status, "pending");
  const accepted = await app.owner("review", { ...request, expectedSnapshotId: saved.body.snapshotId });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.draft.nodes[1].data.birthday, nodes[1].data.birthday);
  const conflict = await app.owner("review", { ...request, review: { status: "rejected" } });
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, "STALE_REVIEW");
  assert.deepEqual(await hashes(app.paths), before);
});

async function running(t, options = {}) {
  const project = await createProject(t, { site: true, ...options });
  const messages = [];
  let application;
  const app = { ...project, messages,
    directory: path.join(project.paths.privateDir, "suggestions"),
    async restart() {
      if (application) {
        application.server.closeAllConnections();
        await new Promise(resolve => application.server.close(resolve));
      }
      application = await createLocalServer({ root: project.paths.root,
        logger: Object.fromEntries(["error", "info", "warn"].map(level => [level, (...values) => messages.push(values)])) });
      await new Promise(resolve => application.server.listen(0, "127.0.0.1", resolve));
      app.origin = "http://127.0.0.1:" + application.server.address().port;
      app.status = await (await fetch(app.origin + "/api/status")).json();
    },
    async post(route, body, headers = {}) {
      // A raw client is necessary: Node fetch silently replaces a supplied Host.
      return new Promise((resolve, reject) => {
        const request = http.request(new URL(route, app.origin), { method: "POST",
          headers: { Origin: app.origin, "Content-Type": "application/json", ...headers } }, response => {
          const chunks = [];
          response.on("data", chunk => chunks.push(chunk));
          response.on("end", () => resolve({ status: response.statusCode,
            headers: new Headers(response.headers), body: JSON.parse(Buffer.concat(chunks).toString("utf8")) }));
        });
        request.on("error", reject);
        request.end(typeof body === "string" ? body : JSON.stringify(body));
      });
    },
    owner(action, body = {}, headers = {}) {
      return app.post("/api/admin/suggestions/" + action, { password: PASSWORD, ...body },
        { "X-Family-Local-Token": app.status.csrfToken, ...headers });
    },
    guest: body => app.post("/api/suggestions", body),
    configure: () => app.owner("settings", { accessCode: CODE })
  };
  await app.restart();
  t.after(async () => {
    application.server.closeAllConnections();
    await new Promise(resolve => application.server.close(resolve));
  });
  return app;
}

test("local submissions start disabled; only the owner can configure a separate code", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  assert.equal(app.status.localSuggestions, true);
  assert.equal(app.status.submissionCodeConfigured, false);
  assert.equal((await app.guest(text())).status, 403);
  for (const action of ["settings", "list", "get", "review", "draft", "photo", "photo-draft"]) {
    assert.equal((await app.owner(action, { password: CODE })).status, 403);
    assert.equal((await app.owner(action, {}, { "X-Family-Local-Token": "" })).status, 403);
    assert.equal((await app.owner(action, {}, { Origin: "https://untrusted.invalid" })).status, 403);
  }
  for (const accessCode of [PASSWORD, "short", " " + CODE]) {
    assert.equal((await app.owner("settings", { accessCode })).status, 400);
  }
  assert.equal((await app.configure()).status, 200);
  const settings = await readFile(path.join(app.directory, "settings.json"), "utf8");
  assert.match(JSON.parse(settings).codeDigest, /^[a-f0-9]{64}$/);
  assert.equal(settings.includes(CODE), false);
  assert.equal(settings.includes(PASSWORD), false);
  for (const file of ["settings.json", "records/example.json", "history/example.json"]) {
    const response = await fetch(app.origin + "/private/suggestions/" + file);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get("cache-control"), "no-store");
  }
  assert.equal((await app.owner("settings")).body.submissionCodeConfigured, true);
  assert.deepEqual(await hashes(app.paths), before);
});

test("text and visual submissions use shared validation, stay pending and never store credentials", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  await app.configure();
  const privateMessage = "Fictional private content <img src=x onerror=alert(1)>";
  const submitted = await app.guest(text({ message: privateMessage }));
  const visual = await app.guest(graph(app.artifacts));
  assert.equal(submitted.status, 201);
  assert.equal(visual.status, 201);
  for (const invalid of [text({ status: "accepted" }), graph(app.artifacts, { anchorPersonId: "private-person" }),
    graph(app.artifacts, { relationships: [{ from: "approved-anchor", to: "private-person", type: "parentOf" }] })]) {
    assert.equal((await app.guest(invalid)).status, 400);
  }
  const list = await app.owner("list", { query: { limit: 1 } });
  assert.equal(list.status, 200);
  assert.equal(list.body.items.length, 1);
  assert.equal(list.body.items[0].payload, undefined);
  const next = await app.owner("list", { query: { limit: 1, nextToken: list.body.nextToken } });
  assert.equal(next.body.items.length, 1);
  assert.notEqual(list.body.items[0].id, next.body.items[0].id);
  assert.equal(next.body.nextToken, null);
  const filter = await app.owner("list", { query: { type: "graph" } });
  assert.equal(filter.body.items[0].id, visual.body.id);
  for (const id of [submitted.body.id, visual.body.id]) {
    const raw = await readFile(path.join(app.directory, "records", id + ".json"), "utf8");
    assert.equal(JSON.parse(raw).status, "pending");
    assert.equal(raw.includes(CODE), false);
    assert.equal(raw.includes(PASSWORD), false);
  }
  const detail = await app.owner("get", { id: submitted.body.id });
  assert.equal(detail.body.suggestion.payload.message, privateMessage);
  assert.match(detail.body.reviewRevision, /^[a-f0-9]{64}$/);
  for (const secret of [CODE, PASSWORD, privateMessage, "Fictional visitor"]) assert.equal(JSON.stringify(app.messages).includes(secret), false);
  assert.deepEqual(await hashes(app.paths), before);
});

test("reviews preserve verified history, survive restart and reject conflicting or invalid decisions", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  await app.configure();
  const { body: { id } } = await app.guest(text());
  const recordFile = path.join(app.directory, "records", id + ".json");
  const original = await readFile(recordFile);
  const loaded = (await app.owner("get", { id })).body;
  assert.equal((await app.owner("review", { id, review: { status: "accepted" } })).status, 400);
  assert.equal((await app.owner("review", { id, expectedReviewRevision: loaded.reviewRevision,
    review: { status: "unknown" } })).status, 400);
  const accepted = await app.owner("review", { id, expectedReviewRevision: loaded.reviewRevision,
    review: { status: "accepted", reviewerNote: "Fictional checked source" } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.suggestion.status, "accepted");
  const history = await readdir(path.join(app.directory, "history"));
  assert.equal(history.length, 1);
  assert.deepEqual(await readFile(path.join(app.directory, "history", history[0])), original);
  assert.equal((await app.owner("review", { id, expectedReviewRevision: loaded.reviewRevision,
    review: { status: "rejected" } })).status, 409);
  await app.restart();
  const reloaded = (await app.owner("get", { id })).body;
  assert.equal(reloaded.reviewRevision, accepted.body.reviewRevision);
  assert.equal(reloaded.suggestion.review.note, "Fictional checked source");
  const rejected = await app.owner("review", { id, expectedReviewRevision: reloaded.reviewRevision, review: { status: "rejected" } });
  assert.equal(rejected.status, 200);
  const filtered = await app.owner("list", { query: { status: "rejected" } });
  assert.equal(filtered.body.items[0].id, id);
  assert.deepEqual(await hashes(app.paths), before);
});

test("a stale visual branch cannot be accepted and its pending content is preserved", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  await app.configure();
  const submitted = await app.guest(graph(app.artifacts));
  const id = submitted.body.id;
  const loaded = (await app.owner("get", { id })).body;
  const revision = await readFile(app.paths.revision);
  // Change only this isolated fixture's backend revision to simulate a newer edition.
  await writeFile(app.paths.revision, JSON.stringify({ ...app.artifacts.revision, sourceRevision: "sha256:" + "0".repeat(64) }));
  const request = { id, expectedReviewRevision: loaded.reviewRevision, expectedSnapshotId: app.status.snapshotId, review: { status: "accepted" } };
  assert.equal((await app.owner("review", request)).status, 409);
  assert.equal((await app.owner("get", { id })).body.suggestion.status, "pending");
  await writeFile(app.paths.revision, revision);
  assert.equal((await app.owner("review", request)).status, 200);
  assert.deepEqual(await hashes(app.paths), before);
});

test("rotating and disabling the code close guest access without deleting queued suggestions", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  await app.configure();
  const { body: { id } } = await app.guest(text());
  const unknown = graph(app.artifacts, { accessCode: "wrong-code", anchorPersonId: "private-person" });
  const known = graph(app.artifacts, { accessCode: "wrong-code" });
  assert.deepEqual((await app.guest(unknown)).body, (await app.guest(known)).body);
  assert.equal((await app.owner("settings", { accessCode: ROTATED_CODE })).status, 200);
  assert.equal((await app.guest(text())).status, 403);
  assert.equal((await app.guest(text({ accessCode: ROTATED_CODE }))).status, 201);
  assert.equal((await app.owner("settings", { enabled: false })).status, 200);
  assert.equal((await app.guest(text({ accessCode: ROTATED_CODE }))).status, 403);
  assert.equal((await app.owner("get", { id })).body.suggestion.status, "pending");
  await app.restart();
  assert.equal(app.status.submissionCodeConfigured, false);
  assert.equal((await app.guest(text({ accessCode: ROTATED_CODE }))).status, 403);
  assert.deepEqual(await hashes(app.paths), before);
});

test("guest request validation rejects foreign origins, unsupported bodies and excessive attempts", async t => {
  const app = await running(t);
  await app.configure();
  for (const [headers, status] of [
    [{ Origin: "" }, 403], [{ Origin: "null" }, 403], [{ Origin: "https://untrusted.invalid" }, 403],
    [{ Host: "untrusted.invalid" }, 403], [{ "Sec-Fetch-Site": "cross-site" }, 403], [{ "Content-Type": "text/plain" }, 415]
  ]) assert.equal((await app.post("/api/suggestions", text(), headers)).status, status, JSON.stringify(headers));
  assert.equal((await app.guest("{")).status, 400);
  assert.equal((await app.guest("null")).status, 400);
  assert.equal((await app.guest(text({ message: "x".repeat(65000) }))).status, 400);
  assert.equal((await app.guest(text({ message: "x".repeat(66000) }))).status, 413);
  // The four body attempts above also count; malformed/unauthorized origins do not.
  for (let i = 4; i < 30; i++) assert.equal((await app.guest(text({ accessCode: "incorrect" }))).status, 403);
  const limited = await app.guest(text());
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get("retry-after"), "60");
  assert.equal(JSON.stringify(limited.body).includes(CODE), false);
});

test("failed review keeps the original record and retry works; orphan writes cannot replace records", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  await app.configure();
  const { body: { id } } = await app.guest(text());
  const recordFile = path.join(app.directory, "records", id + ".json");
  const original = await readFile(recordFile);
  const { reviewRevision } = (await app.owner("get", { id })).body;
  const history = path.join(app.directory, "history");
  await writeFile(history, "fictional blocked recovery directory");
  const request = { id, expectedReviewRevision: reviewRevision, review: { status: "rejected" } };
  assert.equal((await app.owner("review", request)).status, 500);
  assert.deepEqual(await readFile(recordFile), original);
  await unlink(history);
  await writeFile(path.join(app.directory, "records", "write-fictional-interrupted"), "{partial");
  await app.restart();
  assert.equal((await app.owner("list")).body.items.length, 1);
  assert.equal((await app.owner("review", request)).status, 200);
  assert.deepEqual(await hashes(app.paths), before);
});

test("a failed guest write can be retried; corrupt optional settings cannot break private unlock", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  await app.configure();
  const records = path.join(app.directory, "records");
  await writeFile(records, "fictional storage obstruction");
  const failed = await app.guest(text());
  assert.equal(failed.status, 500);
  assert.deepEqual(failed.body, { error: "Submission failed" });
  await unlink(records);
  assert.equal((await app.guest(text())).status, 201);
  await writeFile(path.join(app.directory, "settings.json"), "null");
  await app.restart();
  assert.equal(app.status.localSave, true);
  assert.equal(app.status.submissionCodeConfigured, false);
  const opened = await app.post("/api/session", { password: PASSWORD, payloadDigest: app.status.payloadDigest },
    { "X-Family-Local-Token": app.status.csrfToken });
  assert.equal(opened.status, 200);
  assert.deepEqual(await hashes(app.paths), before);
});

test("accepting a visual branch prepares a private draft; only a separate Save changes the five artifacts", async t => {
  const app = await running(t);
  const before = await hashes(app.paths);
  await app.configure();
  const { body: { id } } = await app.guest(graph(app.artifacts));
  const { reviewRevision } = (await app.owner("get", { id })).body;
  const accepted = await app.owner("review", { id, expectedReviewRevision: reviewRevision,
    expectedSnapshotId: app.status.snapshotId, review: { status: "accepted" } });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.suggestion.status, "accepted");
  const draft = accepted.body.draft;
  assert.equal(draft.baseSnapshotId, app.status.snapshotId);
  assert.equal(draft.suggestionId, id);
  const added = draft.nodes.find(person => !app.nodes.some(original => original.id === person.id));
  assert.match(added.id, /^sg_[0-9a-f]{32}_1$/);
  assert.deepEqual(added.rels.parents, ["approved-anchor"]);
  assert.deepEqual(draft.nodes.find(person => person.id === "approved-anchor").rels.children, [added.id]);
  assert.equal(added.privacy?.publicAnchor === true, false);
  assert.deepEqual(await hashes(app.paths), before);

  // The owner can restore a discarded draft after restarting, without changing
  // its review decision or adding another history entry.
  await app.restart();
  const reloaded = (await app.owner("get", { id })).body;
  const history = await readdir(path.join(app.directory, "history"));
  const again = await app.owner("draft", { id, expectedReviewRevision: reloaded.reviewRevision, expectedSnapshotId: app.status.snapshotId });
  assert.equal(again.status, 200);
  assert.deepEqual(again.body.draft, draft);
  assert.deepEqual(await readdir(path.join(app.directory, "history")), history);
  assert.deepEqual(await hashes(app.paths), before);

  const saved = await app.post("/api/save", { nodes: draft.nodes, password: PASSWORD,
    expectedRevision: app.status.privateRevision, snapshotId: app.status.snapshotId, operationId: "fictional-suggestion-draft-save" },
    { "X-Family-Local-Token": app.status.csrfToken });
  assert.equal(saved.status, 200);
  assert.equal(saved.body.ok, true);
  assert.deepEqual(JSON.parse(await readFile(app.paths.canonical, "utf8")), draft.nodes);
  assert.deepEqual(await decryptFamily(JSON.parse(await readFile(app.paths.encrypted, "utf8")), PASSWORD), draft.nodes);
  const catalog = JSON.parse(await readFile(app.paths.catalog, "utf8"));
  assert.deepEqual(catalog.anchors, app.artifacts.catalog.anchors);
  assert.deepEqual(catalog.relationships, app.artifacts.catalog.relationships);
  const after = await hashes(app.paths);
  assert.equal((await app.owner("draft", { id, expectedReviewRevision: reloaded.reviewRevision, expectedSnapshotId: saved.body.snapshotId })).status, 409);
  assert.deepEqual(await hashes(app.paths), after);
});

test("visual approval and draft preparation reject stale full snapshots and stale reviews", async t => {
  const app = await running(t);
  await app.configure();
  const { body: { id } } = await app.guest(graph(app.artifacts));
  const loaded = (await app.owner("get", { id })).body;
  const request = { id, expectedReviewRevision: loaded.reviewRevision,
    expectedSnapshotId: app.status.snapshotId, review: { status: "accepted" } };
  assert.equal((await app.owner("draft", request)).status, 400); // unsupported review field
  assert.equal((await app.owner("draft", { id, expectedReviewRevision: loaded.reviewRevision, expectedSnapshotId: app.status.snapshotId })).status, 409);
  assert.equal((await app.owner("review", { ...request, expectedSnapshotId: undefined })).status, 400);
  const nodes = structuredClone(app.nodes);
  nodes[1].data.birthday = "Fictional newer private detail";
  const saved = await app.post("/api/save", { nodes, password: PASSWORD, expectedRevision: app.status.privateRevision,
    snapshotId: app.status.snapshotId, operationId: "fictional-before-draft-change" }, { "X-Family-Local-Token": app.status.csrfToken });
  assert.equal(saved.body.ok, true);
  const afterMaintenance = await hashes(app.paths);
  const stale = await app.owner("review", request);
  assert.equal(stale.status, 409);
  assert.equal(stale.body.code, "STALE_SNAPSHOT");
  assert.equal((await app.owner("get", { id })).body.suggestion.status, "pending");
  const accepted = await app.owner("review", { ...request, expectedSnapshotId: saved.body.snapshotId });
  assert.equal(accepted.status, 200);
  assert.equal(accepted.body.draft.nodes[1].data.birthday, nodes[1].data.birthday);
  const changedReview = await app.owner("draft", { id, expectedReviewRevision: loaded.reviewRevision, expectedSnapshotId: saved.body.snapshotId });
  assert.equal(changedReview.status, 409);
  assert.equal(changedReview.body.code, "STALE_REVIEW");
  assert.deepEqual(await hashes(app.paths), afterMaintenance);
});

test("complete-tree validation rejects a third parent before approving or creating a draft", async t => {
  const nodes = await fixture("valid-public-anchor.json");
  nodes[0].rels.parents = ["fictional-private-parent-a", "fictional-private-parent-b"];
  for (const id of nodes[0].rels.parents) nodes.push({ id, data: { "first name": "Fictional private parent", gender: "M" },
    rels: { parents: [], children: ["approved-anchor"], spouses: [] } });
  const app = await running(t, { nodes });
  const before = await hashes(app.paths);
  await app.configure();
  const submitted = await app.guest(graph(app.artifacts, { relationships: [{ from: "tmp_1", to: "approved-anchor", type: "parentOf" }] }));
  assert.equal(submitted.status, 201);
  const id = submitted.body.id;
  const { reviewRevision } = (await app.owner("get", { id })).body;
  const response = await app.owner("review", { id, expectedReviewRevision: reviewRevision,
    expectedSnapshotId: app.status.snapshotId, review: { status: "accepted" } });
  assert.equal(response.status, 400);
  assert.equal(response.body.code, "INVALID_ADDITIONS");
  assert.equal(JSON.stringify(response.body).includes("fictional-private-parent"), false);
  assert.equal(JSON.stringify(app.messages).includes("fictional-private-parent"), false);
  assert.equal((await app.owner("get", { id })).body.suggestion.status, "pending");
  assert.deepEqual(await hashes(app.paths), before);
});

const photoBody = (extra = {}) => ({ accessCode: CODE, name: "fictional attachment.html", type: "image/png", content: PNG.toString("base64"), ...extra });
async function submittedPhoto(app, visual = false) {
  const uploaded = await app.post("/api/suggestions/photos", photoBody());
  assert.equal(uploaded.status, 201);
  const submitted = await app.guest({ ...(visual ? graph(app.artifacts) : text()),
    photoTokens: [{ token: uploaded.body.token, caption: "Fictional photo <img src=x>" }] });
  assert.equal(submitted.status, 201);
  const loaded = (await app.owner("get", { id: submitted.body.id })).body;
  return { id: submitted.body.id, photo: loaded.suggestion.attachments[0], token: uploaded.body.token, ...loaded };
}

test("guest photo upload needs the same code and origin, validates bytes and stores only private pending media", async t => {
  const app = await running(t), before = await hashes(app.paths);
  await app.configure();
  for (const [body, headers, expected] of [
    [photoBody({ accessCode: "wrong" }), {}, 403], [photoBody(), { Origin: "https://untrusted.invalid" }, 403],
    [photoBody(), { "Content-Type": "text/plain" }, 415],
    [photoBody({ content: Buffer.from("<svg onload=alert(1)>").toString("base64"), type: "image/svg+xml" }), {}, 415],
    [photoBody({ content: "invalid-base64" }), {}, 400], [photoBody({ type: "image/jpeg" }), {}, 415],
    [photoBody({ content: "A".repeat(Math.ceil(8 * 1024 * 1024 / 3) * 4 + 8192) }), {}, 413]
  ]) assert.equal((await app.post("/api/suggestions/photos", body, headers)).status, expected);
  assert.equal(await fileExists(path.join(app.directory, "media")), false);
  const sent = await submittedPhoto(app);
  assert.equal(sent.photo.name, "fictional attachment.png");
  assert.equal(sent.photo.caption, "Fictional photo <img src=x>");
  assert.equal(await fileExists(app.paths.media), false);
  const file = path.join(app.directory, "records", sent.id + ".json");
  const stored = await readFile(file, "utf8");
  for (const secret of [CODE, PASSWORD, sent.token]) assert.equal(stored.includes(secret), false);
  for (const secret of [CODE, PASSWORD, sent.token, "fictional attachment", "Fictional photo"]) assert.equal(JSON.stringify(app.messages).includes(secret), false);
  for (const relative of ["/private/suggestions/media/" + sent.photo.id + ".image", "/private/suggestions/uploads/" + sent.token + ".json"]) {
    assert.equal((await fetch(app.origin + relative)).status, 404);
  }
  for (const photoTokens of [[{ token: "f".repeat(64), caption: "" }],
    Array(7).fill({ token: sent.token, caption: "" }), Array(2).fill({ token: sent.token, caption: "" })]) {
    assert.equal((await app.guest(text({ photoTokens }))).status, 400);
  }
  assert.equal((await app.guest(text({ accessCode: "wrong", photoTokens: [{ token: "f".repeat(64), caption: "" }] }))).status, 403);
  assert.deepEqual(await hashes(app.paths), before);
});

test("only an authenticated owner can read a record's exact photo; the original bytes remain intact", async t => {
  const app = await running(t);
  await app.configure();
  const sent = await submittedPhoto(app);
  const body = { password: PASSWORD, id: sent.id, photoId: sent.photo.id };
  const headers = { Origin: app.origin, "Content-Type": "application/json", "X-Family-Local-Token": app.status.csrfToken };
  for (const [changes, extra, expected] of [
    [{ password: CODE }, {}, 403], [{}, { Origin: "null" }, 403], [{}, { "X-Family-Local-Token": "" }, 403],
    [{ photoId: "f".repeat(64) }, {}, 404], [{ id: "11111111-1111-4111-8111-111111111111" }, {}, 404]
  ]) assert.equal((await fetch(app.origin + "/api/admin/suggestions/photo", { method: "POST", headers: { ...headers, ...extra }, body: JSON.stringify({ ...body, ...changes }) })).status, expected);
  const response = await fetch(app.origin + "/api/admin/suggestions/photo", { method: "POST", headers, body: JSON.stringify(body) });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "image/png");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
  const unapproved = await fetch(app.origin + "/api/media/read", { method: "POST", headers, body: JSON.stringify({ password: PASSWORD, id: sent.photo.id }) });
  assert.equal(unapproved.status, 404);
});

test("approved photo assignment enters a gallery draft without changing privacy or main photo, then saves normally", async t => {
  const app = await running(t), before = await hashes(app.paths);
  await app.configure();
  const sent = await submittedPhoto(app);
  const request = { id: sent.id, nodes: app.nodes, assignments: [{ id: sent.photo.id, personId: "approved-anchor" }],
    expectedReviewRevision: sent.reviewRevision, expectedSnapshotId: app.status.snapshotId };
  assert.equal((await app.owner("photo-draft", request)).status, 409);
  const reviewed = await app.owner("review", { id: sent.id, expectedReviewRevision: sent.reviewRevision, review: { status: "accepted" } });
  assert.deepEqual(reviewed.body.suggestion.attachments, [sent.photo]);
  assert.equal((await app.owner("photo-draft", request)).status, 409);
  request.expectedReviewRevision = reviewed.body.reviewRevision;
  assert.equal((await app.owner("photo-draft", { ...request, expectedSnapshotId: "sha256:" + "0".repeat(64) })).status, 409);
  assert.equal((await app.owner("photo-draft", { ...request, assignments: [{ id: sent.photo.id, personId: "absent" }] })).status, 400);
  const prepared = await app.owner("photo-draft", request);
  assert.equal(prepared.status, 200);
  const draft = prepared.body.draft;
  assert.deepEqual(draft.nodes[0].data.gallery, [sent.photo]);
  assert.equal(draft.nodes[0].data.avatar, app.nodes[0].data.avatar);
  assert.deepEqual(draft.nodes[0].privacy, app.nodes[0].privacy);
  assert.deepEqual(await readFile(path.join(app.paths.media, sent.photo.id + ".image")), PNG);
  assert.deepEqual(await hashes(app.paths), before);
  const duplicate = await app.owner("photo-draft", { ...request, nodes: draft.nodes });
  assert.deepEqual(duplicate.body.draft.nodes, draft.nodes);
  const saved = await app.post("/api/save", { nodes: draft.nodes, password: PASSWORD, snapshotId: app.status.snapshotId,
    expectedRevision: app.status.privateRevision, operationId: "fictional-approved-photo-save" }, { "X-Family-Local-Token": app.status.csrfToken });
  assert.equal(saved.body.ok, true);
  assert.deepEqual(await decryptFamily(JSON.parse(await readFile(app.paths.encrypted, "utf8")), PASSWORD), draft.nodes);
  assert.deepEqual(JSON.parse(await readFile(app.paths.catalog, "utf8")), app.artifacts.catalog);
});

test("photo assignment supports new people in an unsaved approved branch and preserves other draft edits", async t => {
  const app = await running(t), before = await hashes(app.paths);
  await app.configure();
  const sent = await submittedPhoto(app, true);
  const reviewed = await app.owner("review", { id: sent.id, expectedReviewRevision: sent.reviewRevision,
    expectedSnapshotId: app.status.snapshotId, review: { status: "accepted" } });
  assert.equal(reviewed.status, 200);
  const nodes = reviewed.body.draft.nodes;
  nodes[1].data.birthday = "Fictional owner draft kept";
  const personId = nodes.at(-1).id;
  const result = await app.owner("photo-draft", { id: sent.id, nodes, assignments: [{ id: sent.photo.id, personId }],
    expectedReviewRevision: reviewed.body.reviewRevision, expectedSnapshotId: app.status.snapshotId });
  assert.equal(result.status, 200);
  assert.equal(result.body.draft.nodes[1].data.birthday, nodes[1].data.birthday);
  assert.deepEqual(result.body.draft.nodes.at(-1).data.gallery, [sent.photo]);
  assert.equal(result.body.draft.nodes.at(-1).privacy?.publicAnchor === true, false);
  assert.deepEqual(await hashes(app.paths), before);
});

test("failed media copying and corrupt pending bytes cannot change family artifacts and allow a repaired retry", async t => {
  const app = await running(t), before = await hashes(app.paths);
  await app.configure();
  const sent = await submittedPhoto(app);
  const reviewed = await app.owner("review", { id: sent.id, expectedReviewRevision: sent.reviewRevision, review: { status: "accepted" } });
  const request = { id: sent.id, nodes: app.nodes, assignments: [{ id: sent.photo.id, personId: "private-person" }],
    expectedReviewRevision: reviewed.body.reviewRevision, expectedSnapshotId: app.status.snapshotId };
  await writeFile(app.paths.media, "fictional storage obstruction");
  assert.equal((await app.owner("photo-draft", request)).status, 500);
  assert.equal(await readFile(app.paths.media, "utf8"), "fictional storage obstruction");
  await unlink(app.paths.media);
  const pendingFile = path.join(app.directory, "media", sent.photo.id + ".image");
  await writeFile(pendingFile, "fictional corrupt bytes");
  assert.equal((await app.owner("photo-draft", request)).status, 409);
  assert.deepEqual(await hashes(app.paths), before);
  await writeFile(pendingFile, PNG);
  assert.equal((await app.owner("photo-draft", request)).status, 200);
  assert.deepEqual(await hashes(app.paths), before);
});
