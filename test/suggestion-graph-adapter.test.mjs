import assert from "node:assert/strict";
import test from "node:test";
import { VisualSuggestionDraft } from "../assets/suggestions/draft-model.js";
import {
  createSuggestionCardHtml,
  draftToFamilyChartNodes,
  escapeHtml
} from "../assets/suggestions/graph-adapter.js";

const VERSION = `sha256:${"e".repeat(64)}`;
const REVISION = `sha256:${"f".repeat(64)}`;
const ANCHOR = Object.freeze({
  id: "approved-anchor",
  displayLabel: "Reviewed Anchor",
  lifespanLabel: "1900–1980",
  branchLabel: "Fictional branch"
});

test("adapts only the anchor and proposed people into reciprocal Family Chart nodes", () => {
  const draft = selectedDraft();
  const child = draft.addChild(ANCHOR.id, person("Child", "M"));
  const spouse = draft.addSpouse(child.id, person("Spouse", "F"));
  const nodes = draftToFamilyChartNodes(draft.getSnapshot(), ANCHOR);

  assert.deepEqual(nodes.map((node) => node.id), [ANCHOR.id, child.id, spouse.id]);
  assert.deepEqual(nodes[0].rels.children, [child.id]);
  assert.deepEqual(nodes[1].rels.parents, [ANCHOR.id]);
  assert.deepEqual(nodes[1].rels.spouses, [spouse.id]);
  assert.deepEqual(nodes[2].rels.spouses, [child.id]);
  assert.equal(JSON.stringify(nodes).includes("avatar"), false);
  assert.equal(JSON.stringify(nodes).includes("private"), false);
});

test("rejects an anchor that does not match the authoritative draft", () => {
  const draft = selectedDraft();
  assert.throws(
    () => draftToFamilyChartNodes(draft.getSnapshot(), { ...ANCHOR, id: "wrong" }),
    /does not match/
  );
});

test("escapes untrusted card text before Family Chart receives HTML", () => {
  const malicious = `<img src=x onerror="alert(1)"> O'Brien & family`;
  assert.equal(escapeHtml(malicious).includes("<img"), false);
  const html = createSuggestionCardHtml({
    data: {
      id: "tmp_1",
      data: {
        "first name": malicious,
        "last name": "<script>bad()</script>",
        birthday: "",
        branchLabel: "",
        visualType: "proposed"
      }
    }
  });
  assert.equal(html.includes("<img src=x"), false);
  assert.equal(html.includes("<script>bad()"), false);
  assert.match(html, /&lt;img/);
  assert.match(html, /&lt;script&gt;/);
});

function selectedDraft() {
  const draft = new VisualSuggestionDraft();
  draft.selectAnchor(ANCHOR, {
    anchorCatalogVersion: VERSION,
    sourceRevision: REVISION
  });
  return draft;
}

function person(firstName, gender) {
  return { firstName, lastName: "Example", birthday: "1970", gender };
}
