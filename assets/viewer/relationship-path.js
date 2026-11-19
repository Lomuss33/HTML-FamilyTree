// Search only the supplied display model. Public viewing supplies the approved
// public graph, so private intermediaries cannot enter a path or its explanation.
const relations = ["parents", "children", "spouses"];
const types = { parents: "parent", children: "child", spouses: "partner" };
export const RELATIONSHIP_LABELS = Object.freeze({ parent: "roditelj", child: "dijete", partner: "supružnik/partner" });

export function findRelationshipPath(nodes, fromId, toId) {
  const byId = new Map(nodes.map(person => [person.id, person]));
  if (!byId.has(fromId) || !byId.has(toId)) return null;
  const previous = new Map([[fromId, null]]);
  const queue = [fromId];
  for (let index = 0; index < queue.length; index++) {
    const id = queue[index];
    if (id === toId) {
      const path = [];
      for (let cursor = toId; cursor !== null;) {
        const step = previous.get(cursor);
        path.push({ id: cursor, relation: step?.relation ?? null });
        cursor = step?.from ?? null;
      }
      return path.reverse();
    }
    const person = byId.get(id);
    for (const key of relations) {
      // Sort a copy for stable results when equally short paths exist. Missing
      // endpoints and malformed arrays do not invent reciprocal relationships.
      const ids = Array.isArray(person.rels?.[key]) ? [...person.rels[key]] : [];
      ids.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const next of ids) {
        if (!byId.has(next) || previous.has(next)) continue;
        previous.set(next, { from: id, relation: types[key] });
        queue.push(next);
      }
    }
  }
  return null;
}

export function relationshipPathLabel(path) {
  const steps = path.slice(1).map(step => step.relation);
  if (!steps.length) return "Ovo je odabrana početna osoba.";
  if (steps.length === 1) return {
    parent: "Roditelj početne osobe.",
    child: "Dijete početne osobe.",
    partner: "Upisana partnerska veza."
  }[steps[0]];
  if (steps.every(step => step === "parent")) return "Predak početne osobe · broj generacija: " + steps.length + ".";
  if (steps.every(step => step === "child")) return "Potomak početne osobe · broj generacija: " + steps.length + ".";
  if (steps[0] === "parent" && steps.at(-1) === "child" && !steps.includes("partner")) {
    const firstChild = steps.indexOf("child");
    if (steps.slice(firstChild).every(step => step === "child")) return steps.length === 2
      ? "Osobe dijele upisanog roditelja." : "Veza preko zajedničkog pretka.";
  }
  return steps.includes("partner") ? "Put uključuje supružnika ili partnera." : "Put kroz upisane roditeljske veze.";
}
