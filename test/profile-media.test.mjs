import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createProject, hashes, PASSWORD } from "./helpers/project.mjs";
import { PNG } from "./helpers/photos.mjs";
import { createFamilyWorkflow } from "../scripts/lib/family-workflow.mjs";
import { createMediaStore } from "../scripts/lib/media-store.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
import { validateFamilyData } from "../scripts/validate-family-data.mjs";
import { decryptFamily } from "../scripts/lib/family-crypto.mjs";
import { findPeople } from "../assets/viewer/person-browser.js";
import { REPOSITORY_ROOT, projectPaths } from "../scripts/lib/project-paths.mjs";
import { MAX_IMAGE_BYTES } from "../assets/viewer/media-data.js";

const exec = promisify(execFile);
async function requestFor(workflow, nodes) {
  const snapshot = await workflow.snapshot();
  return { nodes, password: PASSWORD, expectedRevision: snapshot.privateRevision,
    snapshotId: snapshot.snapshotId, operationId: randomUUID() };
}
const reference = result => ({ ...result, name: "fictional.png", caption: "Fictional photograph" });

test("profile fields and residence history round-trip through the shared encrypted save and aliases are searchable", async t => {
  const { paths, nodes } = await createProject(t);
  const workflow = createFamilyWorkflow(paths);
  const originalRelations = structuredClone(nodes[0].rels);
  Object.assign(nodes[0].data, { "maiden name": "Šarić", "previous names": "Fictional former name\nAnother former name",
    nicknames: "Đuro, Žućo", birthplace: "Fictional town", notes: "Occupation and source\n<script>not executable</script>",
    residences: [{ place: "First fictional town", from: "oko 1950", to: "1970" }, { place: "Second town", from: "1970", to: "" }] });
  assert.equal((await workflow.save(await requestFor(workflow, nodes))).ok, true);
  assert.deepEqual(await decryptFamily(JSON.parse(await readFile(paths.encrypted, "utf8")), PASSWORD), nodes);
  assert.deepEqual(nodes[0].rels, originalRelations);
  assert.equal(findPeople(nodes, "duro saric")[0].id, nodes[0].id);
  assert.equal(findPeople(nodes, "another former name")[0].id, nodes[0].id);
  const publicText = await readFile(paths.catalog, "utf8");
  for (const value of ["Šarić", "Fictional town", "Occupation", "residences", "notes"]) assert.equal(publicText.includes(value), false);
});

test("malformed profile histories and photo references are rejected without normalizing records", async t => {
  const { nodes } = await createProject(t);
  for (const patch of [{ nicknames: [] }, { residences: null }, { residences: [{ place: "", from: "1950", to: "" }] },
    { residences: [{ place: "Somewhere", from: 1950, to: "" }] }, { gallery: null },
    { avatar: "media:" + "f".repeat(64), gallery: [] }]) {
    const candidate = structuredClone(nodes); Object.assign(candidate[0].data, patch);
    const before = structuredClone(candidate);
    assert.throws(() => validateFamilyData(candidate));
    assert.deepEqual(candidate, before);
  }
});

test("photo HTTP routes require password/origin/token and stored originals remain private and byte-identical", async t => {
  const { paths, nodes } = await createProject(t, { site: true });
  const { server } = await createLocalServer({ root: paths.root });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const origin = "http://127.0.0.1:" + server.address().port;
  const status = await (await fetch(origin + "/api/status")).json();
  const headers = { Origin: origin, "Content-Type": "application/json", "X-Family-Local-Token": status.csrfToken };
  const body = { password: PASSWORD, payloadDigest: status.payloadDigest, type: "image/png", content: PNG.toString("base64") };
  const before = await hashes(paths);
  for (const [extraHeaders, extraBody, expected] of [
    [{ Origin: "https://untrusted.example" }, {}, 403], [{ "X-Family-Local-Token": "" }, {}, 403],
    [{ "Content-Type": "text/plain" }, {}, 415], [{}, { password: "incorrect" }, 403],
    [{}, { type: "image/svg+xml" }, 415], [{}, { content: "not base64" }, 400]
  ]) {
    const response = await fetch(origin + "/api/media/upload", { method: "POST", headers: { ...headers, ...extraHeaders }, body: JSON.stringify({ ...body, ...extraBody }) });
    assert.equal(response.status, expected);
  }
  assert.deepEqual(await hashes(paths), before);
  const uploaded = await (await fetch(origin + "/api/media/upload", { method: "POST", headers, body: JSON.stringify(body) })).json();
  assert.equal(uploaded.ok, true);
  const media = createMediaStore(paths);
  assert.deepEqual((await media.read(uploaded.id)).bytes, PNG);
  const read = await fetch(origin + "/api/media/read", { method: "POST", headers,
    body: JSON.stringify({ password: PASSWORD, payloadDigest: status.payloadDigest, id: uploaded.id }) });
  assert.equal(read.headers.get("content-type"), "image/png");
  assert.deepEqual(Buffer.from(await read.arrayBuffer()), PNG);
  nodes[0].data.gallery = [reference({ id: uploaded.id, type: uploaded.type })];
  nodes[0].data.avatar = "media:" + uploaded.id;
  const saved = await (await fetch(origin + "/api/save", { method: "POST", headers,
    body: JSON.stringify({ nodes, password: PASSWORD, expectedRevision: status.privateRevision,
      snapshotId: status.snapshotId, operationId: randomUUID() }) })).json();
  assert.equal(saved.ok, true);
  const afterSave = await fetch(origin + "/api/media/read", { method: "POST", headers,
    body: JSON.stringify({ password: PASSWORD, payloadDigest: status.payloadDigest, id: uploaded.id }) });
  assert.deepEqual(Buffer.from(await afterSave.arrayBuffer()), PNG);
  assert.equal((await fetch(origin + "/private/media/" + uploaded.id + ".image")).status, 404);
  assert.equal((await fetch(origin + "/api/media/read")).status, 405);
  const wrong = await fetch(origin + "/api/media/read", { method: "POST", headers,
    body: JSON.stringify({ password: "incorrect", payloadDigest: status.payloadDigest, id: uploaded.id }) });
  assert.equal(wrong.status, 403);
  nodes[0].data.gallery = [reference({ id: uploaded.id, type: uploaded.type })];
  nodes[0].data.avatar = "media:" + uploaded.id;
  const workflow = createFamilyWorkflow(paths);
  assert.equal((await workflow.save(await requestFor(workflow, nodes))).ok, true);
  assert.equal((await readFile(paths.catalog, "utf8")).includes(uploaded.id), false);
  nodes[0].data.gallery = []; nodes[0].data.avatar = "";
  assert.equal((await workflow.save(await requestFor(workflow, nodes))).ok, true);
  assert.deepEqual((await media.read(uploaded.id)).bytes, PNG);
});

test("missing or corrupt images cannot commit a tree and existing image bytes are never overwritten", async t => {
  const { paths, nodes } = await createProject(t);
  const workflow = createFamilyWorkflow(paths);
  const before = await hashes(paths);
  nodes[0].data.gallery = [reference({ id: "f".repeat(64), type: "image/png" })];
  nodes[0].data.avatar = "media:" + "f".repeat(64);
  await assert.rejects(workflow.save(await requestFor(workflow, nodes)), { code: "MEDIA_NOT_FOUND" });
  assert.deepEqual(await hashes(paths), before);
  const media = createMediaStore(paths);
  const stored = await media.put(PNG, "image/png");
  const file = path.join(paths.media, stored.id + ".image");
  await writeFile(file, "fictional corruption");
  await assert.rejects(media.put(PNG, "image/png"), { code: "MEDIA_CORRUPT" });
  assert.equal(await readFile(file, "utf8"), "fictional corruption");
  assert.deepEqual(await hashes(paths), before);
});

test("a failed tree save preserves both the previous five artifacts and staged photo originals", async t => {
  const { paths, nodes } = await createProject(t);
  const media = createMediaStore(paths);
  const photo = await media.put(PNG, "image/png");
  const before = await hashes(paths);
  nodes[0].data.gallery = [reference(photo)]; nodes[0].data.avatar = "media:" + photo.id;
  const workflow = createFamilyWorkflow(paths, { fault: async point => { if (point === "after:catalog") throw new Error("Fictional save failure"); } });
  await assert.rejects(workflow.save(await requestFor(workflow, nodes)), { code: "SAVE_FAILED" });
  assert.deepEqual(await hashes(paths), before);
  assert.deepEqual((await media.read(photo.id)).bytes, PNG);
});

test("oversized, unsupported and missing photo inputs cannot change a saved tree", async t => {
  const { paths, nodes } = await createProject(t);
  const before = await hashes(paths);
  const media = createMediaStore(paths);
  await assert.rejects(media.put(Buffer.alloc(MAX_IMAGE_BYTES + 1), "image/png"), { code: "PAYLOAD_TOO_LARGE" });
  await assert.rejects(media.put(Buffer.from("<svg onload='bad()'/>"), "image/svg+xml"), { code: "INVALID_MEDIA" });
  nodes[0].data.gallery = [{ id: "a".repeat(64), type: "image/png", name: "missing.png", caption: "" }];
  const workflow = createFamilyWorkflow(paths);
  await assert.rejects(workflow.save(await requestFor(workflow, nodes)), { code: "MEDIA_NOT_FOUND" });
  assert.deepEqual(await hashes(paths), before);
});

test("backup and empty-target restore carry verified private photo copies; dry-run leaves the target untouched", async t => {
  const { paths, nodes } = await createProject(t);
  const photo = await createMediaStore(paths).put(PNG, "image/png");
  nodes[0].data.gallery = [reference(photo)]; nodes[0].data.avatar = "media:" + photo.id;
  const workflow = createFamilyWorkflow(paths);
  await workflow.save(await requestFor(workflow, nodes));
  const run = async (script, root, args = []) => JSON.parse((await exec(process.execPath,
    [path.join(REPOSITORY_ROOT, "scripts", script), "--root", root, ...args], {
      cwd: REPOSITORY_ROOT, env: { ...process.env, FAMILY_TREE_PASSWORD: PASSWORD }, timeout: 30000
    })).stdout);
  const backup = await run("backup-family.mjs", paths.root);
  assert.equal(backup.photoCount, 1);
  const target = path.join(paths.root, "photo-restore"); await mkdir(target);
  const backupFile = path.join(paths.root, backup.backup);
  const checked = await run("restore-family.mjs", target, ["--backup", backupFile, "--initialize", "--dry-run"]);
  assert.equal(checked.dryRun, true);
  await assert.rejects(readFile(projectPaths(target).canonical), { code: "ENOENT" });
  await run("restore-family.mjs", target, ["--backup", backupFile, "--initialize", "--approve-publication"]);
  assert.deepEqual(JSON.parse(await readFile(projectPaths(target).canonical, "utf8")), nodes);
  assert.deepEqual((await createMediaStore(projectPaths(target)).read(photo.id)).bytes, PNG);
});
