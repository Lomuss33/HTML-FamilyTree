import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile } from "node:fs/promises";
import { createProject, PASSWORD } from "./helpers/project.mjs";
import { encryptFamily, jsonText, digest } from "../scripts/lib/family-crypto.mjs";
import { migrateFamily } from "../scripts/lib/migrate-family.mjs";
import { createLocalServer } from "../scripts/local-server.mjs";
import { hashPayloadText } from "../assets/editor/local-api.js";

test("a migrated CRLF ciphertext unlocks against normalized public bytes while its original file stays untouched", async t => {
  const { paths, nodes } = await createProject(t, { legacy: true, site: true });
  const legacy = structuredClone(nodes);
  for (const node of legacy) {
    delete node.privacy;
    for (const key of ["parents", "children", "spouses"]) if (!node.rels[key].length) delete node.rels[key];
  }
  await writeFile(paths.legacy, jsonText(legacy));
  const encryptedText = jsonText(await encryptFamily(legacy, PASSWORD, { iterations: 100000 })).replaceAll("\n", "\r\n");
  await writeFile(paths.encrypted, encryptedText);
  await migrateFamily(paths, { keepExistingAnchors: true });
  const application = await createLocalServer({ root: paths.root });
  await new Promise(resolve => application.server.listen(0, "127.0.0.1", resolve));
  t.after(async () => {
    application.server.closeAllConnections();
    await new Promise(resolve => application.server.close(resolve));
  });
  const origin = "http://127.0.0.1:" + application.server.address().port;
  const status = await (await fetch(origin + "/api/status")).json();
  const publicText = await (await fetch(origin + "/data/family.enc.json")).text();
  assert.equal(publicText.includes("\r"), false);
  assert.equal(await hashPayloadText(publicText), status.payloadDigest);
  assert.notEqual(digest(encryptedText), status.payloadDigest);
  const response = await fetch(origin + "/api/session", {
    method: "POST",
    headers: { Origin: origin, "Content-Type": "application/json", "X-Family-Local-Token": status.csrfToken },
    body: JSON.stringify({ password: PASSWORD, payloadDigest: status.payloadDigest })
  });
  assert.equal(response.status, 200);
  const unlocked = await response.json();
  assert.equal(unlocked.needsPreparation, true);
  assert.equal(unlocked.nodes.filter(node => node.privacy?.publicAnchor).length, 1);
  assert.equal(await readFile(paths.encrypted, "utf8"), encryptedText);
});
