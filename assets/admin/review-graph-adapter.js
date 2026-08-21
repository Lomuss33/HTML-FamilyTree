import { validateVisualDraft } from "../suggestions/draft-model.js";
import { escapeHtml } from "../suggestions/graph-adapter.js";

const REVIEW_MODES = new Set(["original", "suggestion", "overlay"]);

export function suggestionToReviewNodes({ mode, canonicalNodes, suggestion }) {
  if (!REVIEW_MODES.has(mode)) throw new Error("Unknown graph review mode.");
  if (!Array.isArray(canonicalNodes)) throw new Error("Unlocked canonical nodes are required.");
  const payload = suggestion?.payload;
  validateVisualDraft({
    schemaVersion: 1,
    anchorPersonId: payload?.anchorPersonId,
    anchorCatalogVersion: payload?.anchorCatalogVersion,
    sourceRevision: payload?.sourceRevision,
    people: payload?.people,
    relationships: payload?.relationships
  });

  const canonicalById = new Map(canonicalNodes.map((node) => [node.id, node]));
  const anchor = canonicalById.get(payload.anchorPersonId);
  if (!anchor) throw new Error("The suggestion anchor is not present in the unlocked canonical tree.");

  const includeCanonicalIds = mode === "suggestion"
    ? new Set([anchor.id])
    : collectOneHopCanonicalIds(anchor, canonicalById);
  const nodes = [...includeCanonicalIds]
    .map((id) => cloneCanonicalNode(canonicalById.get(id), id === anchor.id ? "anchor" : "canonical"))
    .filter(Boolean);

  if (mode !== "original") {
    nodes.push(...payload.people.map((person) => ({
      id: person.id,
      data: {
        "first name": person.firstName,
        "last name": person.lastName,
        birthday: person.birthday,
        gender: person.gender,
        reviewType: "proposed"
      },
      rels: emptyRelationships()
    })));
  }

  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  filterCanonicalRelationships(nodes, nodesById);
  if (mode !== "original") applyProposedRelationships(payload.relationships, nodesById);
  normalizeRelationships(nodes);
  return nodes;
}

export function createReviewCardHtml(chartDatum) {
  const node = chartDatum?.data;
  const data = node?.data ?? {};
  const reviewType = new Set(["anchor", "canonical", "proposed"]).has(data.reviewType)
    ? data.reviewType
    : "canonical";
  const badge = reviewType === "anchor" ? "Anchor" : reviewType === "proposed" ? "Proposed" : "Original";
  const name = [data["first name"], data["last name"]].filter(Boolean).join(" ") || "Unnamed person";

  return `
    <div class="card-inner card-rect admin-review-node admin-review-node--${reviewType}">
      <span class="visual-node-badge">${badge}</span>
      <strong class="visual-node-name">${escapeHtml(name)}</strong>
      ${data.birthday ? `<span class="visual-node-meta">${escapeHtml(data.birthday)}</span>` : ""}
    </div>
  `;
}

function collectOneHopCanonicalIds(anchor, canonicalById) {
  const ids = new Set([anchor.id]);
  for (const relation of ["parents", "children", "spouses"]) {
    for (const id of anchor.rels?.[relation] ?? []) {
      if (canonicalById.has(id)) ids.add(id);
    }
  }
  return ids;
}

function cloneCanonicalNode(node, reviewType) {
  if (!node) return null;
  return {
    id: node.id,
    data: { ...(node.data ?? {}), reviewType },
    rels: {
      parents: [...(node.rels?.parents ?? [])],
      children: [...(node.rels?.children ?? [])],
      spouses: [...(node.rels?.spouses ?? [])]
    }
  };
}

function filterCanonicalRelationships(nodes, nodesById) {
  for (const node of nodes) {
    for (const relation of ["parents", "children", "spouses"]) {
      node.rels[relation] = node.rels[relation].filter((id) => nodesById.has(id));
    }
  }
}

function applyProposedRelationships(relationships, nodesById) {
  for (const relationship of relationships) {
    const from = nodesById.get(relationship.from);
    const to = nodesById.get(relationship.to);
    if (!from || !to) throw new Error("Suggestion relationship has an unavailable endpoint.");
    if (relationship.type === "parentOf") {
      from.rels.children.push(to.id);
      to.rels.parents.push(from.id);
    } else {
      from.rels.spouses.push(to.id);
      to.rels.spouses.push(from.id);
    }
  }
}

function normalizeRelationships(nodes) {
  for (const node of nodes) {
    for (const relation of ["parents", "children", "spouses"]) {
      node.rels[relation] = [...new Set(node.rels[relation])].sort(compareStrings);
    }
  }
}

function emptyRelationships() {
  return { parents: [], children: [], spouses: [] };
}

function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
