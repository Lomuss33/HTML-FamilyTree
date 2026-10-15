export const cloneNodes = value => structuredClone(value);
export const sameNodes = (left, right) => JSON.stringify(left) === JSON.stringify(right);

export function normalizeEditorExport(nodes) {
  return nodes.map(source => {
    const node = cloneNodes(source);
    for (const field of ["_new_rel_data", "main", "to_add", "unknown"]) delete node[field];
    if (!node.rels || typeof node.rels !== "object" || Array.isArray(node.rels)) {
      throw new Error("The relationship object is malformed.");
    }
    for (const relation of ["parents", "children", "spouses"]) {
      if (!Object.hasOwn(node.rels, relation)) node.rels[relation] = [];
      else if (!Array.isArray(node.rels[relation])) throw new Error("A relationship collection is malformed.");
    }
    return node;
  });
}
