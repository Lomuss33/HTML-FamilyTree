import { validateVisualDraft } from "./draft-model.js";

export function draftToFamilyChartNodes(draft, anchor) {
  validateVisualDraft(draft);
  validateAnchorForDraft(anchor, draft.anchorPersonId);

  const nodes = [
    {
      id: anchor.id,
      data: {
        "first name": anchor.displayLabel,
        "last name": "",
        birthday: anchor.lifespanLabel ?? "",
        gender: "",
        branchLabel: anchor.branchLabel ?? "",
        visualType: "anchor"
      },
      rels: emptyRelationships()
    },
    ...draft.people.map((person) => ({
      id: person.id,
      data: {
        "first name": person.firstName,
        "last name": person.lastName,
        birthday: person.birthday,
        gender: person.gender,
        branchLabel: "",
        visualType: "proposed"
      },
      rels: emptyRelationships()
    }))
  ];
  const nodesById = new Map(nodes.map((node) => [node.id, node]));

  for (const relationship of draft.relationships) {
    const from = nodesById.get(relationship.from);
    const to = nodesById.get(relationship.to);
    if (relationship.type === "parentOf") {
      from.rels.children.push(to.id);
      to.rels.parents.push(from.id);
    } else {
      from.rels.spouses.push(to.id);
      to.rels.spouses.push(from.id);
    }
  }

  for (const node of nodes) {
    node.rels.parents.sort(compareStrings);
    node.rels.children.sort(compareStrings);
    node.rels.spouses.sort(compareStrings);
  }
  return nodes;
}

export function createSuggestionCardHtml(chartDatum) {
  const node = chartDatum?.data;
  const data = node?.data ?? {};
  const visualType = data.visualType === "anchor" ? "anchor" : "proposed";
  const badge = visualType === "anchor" ? "Anchor" : "Proposed";
  const displayName = visualType === "anchor"
    ? data["first name"]
    : [data["first name"], data["last name"]].filter(Boolean).join(" ");
  const metadata = [data.birthday, data.branchLabel].filter(Boolean);

  return `
    <div class="card-inner card-rect visual-node-card visual-node-card--${visualType}" data-person-id="${escapeHtml(node?.id ?? "")}">
      <span class="visual-node-badge">${badge}</span>
      <strong class="visual-node-name">${escapeHtml(displayName || "Unnamed person")}</strong>
      ${metadata.map((value) => `<span class="visual-node-meta">${escapeHtml(value)}</span>`).join("")}
    </div>
  `;
}

export function escapeHtml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function validateAnchorForDraft(anchor, anchorPersonId) {
  if (!anchor || typeof anchor !== "object" || Array.isArray(anchor)) {
    throw new Error("A reviewed public anchor is required for graph rendering.");
  }
  const allowed = new Set(["id", "displayLabel", "lifespanLabel", "branchLabel"]);
  for (const key of Object.keys(anchor)) {
    if (!allowed.has(key)) throw new Error(`Public anchor contains unsupported field "${key}".`);
  }
  if (anchor.id !== anchorPersonId) {
    throw new Error("Public anchor id does not match the visual draft anchorPersonId.");
  }
  if (typeof anchor.displayLabel !== "string" || !anchor.displayLabel.trim()) {
    throw new Error("Public anchor displayLabel is required.");
  }
  for (const key of ["lifespanLabel", "branchLabel"]) {
    if (key in anchor && (typeof anchor[key] !== "string" || !anchor[key].trim())) {
      throw new Error(`Public anchor ${key} must be a non-empty string when present.`);
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
