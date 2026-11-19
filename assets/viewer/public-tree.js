import { validatePublicAnchorCatalog } from "../suggestions/public-anchor-catalog.js";

// This is a display model, never a canonical export. Only the reviewed catalog
// enters it; no private source, birth date, avatar or hidden intermediary is read.
export function createPublicTree(value) {
  const catalog = validatePublicAnchorCatalog(value);
  const nodes = catalog.anchors.map(anchor => ({
    id: anchor.id, publicView: true,
    data: { "first name": anchor.displayLabel, "last name": "", birthday: "", avatar: "",
      publicLifespan: anchor.lifespanLabel ?? "", publicBranch: anchor.branchLabel ?? "" },
    rels: { parents: [], spouses: [], children: [] }
  }));
  const byId = new Map(nodes.map(person => [person.id, person]));
  for (const edge of catalog.relationships ?? []) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (edge.type === "parentOf") { from.rels.children.push(to.id); to.rels.parents.push(from.id); }
    else { from.rels.spouses.push(to.id); to.rels.spouses.push(from.id); }
  }
  return nodes;
}
