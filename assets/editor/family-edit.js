const RELATIONS = ["parents", "children", "spouses"];
const TYPES = new Set(["standalone", "parent", "partner", "sibling", "child"]);
const fold = value => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("hr").replaceAll("đ", "d").trim().replace(/\s+/g, " ");

export class FamilyEditError extends Error {
  constructor(code, message) { super(message); this.name = "FamilyEditError"; this.code = code; }
}
const fail = (code, message) => { throw new FamilyEditError(code, message); };

function assertGraph(nodes) {
  if (!Array.isArray(nodes) || !nodes.length) fail("INVALID_TREE", "Stablo nije spremno za uređivanje.");
  const byId = new Map();
  for (const person of nodes) {
    if (!person || typeof person.id !== "string" || !person.id.trim() || byId.has(person.id)
      || !person.data || !person.rels || Object.keys(person.rels).some(key => !RELATIONS.includes(key))) {
      fail("INVALID_TREE", "Podatke stabla treba provjeriti prije povezivanja.");
    }
    byId.set(person.id, person);
    for (const key of RELATIONS) {
      const ids = person.rels[key];
      if (!Array.isArray(ids) || ids.some(id => typeof id !== "string" || !id.trim() || id === person.id) || new Set(ids).size !== ids.length) {
        fail("INVALID_TREE", "Postojeće veze treba provjeriti prije povezivanja.");
      }
    }
    if (person.rels.parents.length > 2) fail("PARENT_LIMIT", "Mogu biti upisana najviše dva roditelja. Postojeći roditelji nisu promijenjeni.");
  }
  for (const person of nodes) for (const [key, reverse] of [["parents", "children"], ["children", "parents"], ["spouses", "spouses"]]) {
    for (const id of person.rels[key]) if (!byId.get(id)?.rels[reverse].includes(person.id)) {
      fail("INVALID_TREE", "Veze moraju biti obostrano upisane. Stablo nije promijenjeno.");
    }
  }
  const counts = new Map(nodes.map(person => [person.id, person.rels.parents.length]));
  const queue = nodes.filter(person => counts.get(person.id) === 0).map(person => person.id);
  for (let index = 0; index < queue.length; index++) for (const child of byId.get(queue[index]).rels.children) {
    counts.set(child, counts.get(child) - 1);
    if (counts.get(child) === 0) queue.push(child);
  }
  if (queue.length !== nodes.length) fail("ANCESTRY_CYCLE", "Ova bi veza stvorila krug u roditeljskim vezama. Stablo nije promijenjeno.");
  return byId;
}

function personData(value) {
  const allowed = ["first name", "last name", "birthday", "gender"];
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) {
    fail("INVALID_PERSON", "Provjeri podatke nove osobe.");
  }
  const result = {};
  for (const [key, maximum] of [["first name", 200], ["last name", 200], ["birthday", 80]]) {
    const text = value[key] ?? "";
    if (typeof text !== "string" || text.length > maximum || text.includes("\0")) fail("INVALID_PERSON", "Provjeri ime, prezime i podatak o rođenju.");
    result[key] = text.trim();
  }
  if (!result["first name"] && !result["last name"]) fail("NAME_REQUIRED", "Upiši barem ime ili prezime nove osobe.");
  if (!["M", "F"].includes(value.gender)) fail("GENDER_REQUIRED", "Odaberi spol za prikaz nove osobe u postojećem stablu.");
  return { ...result, gender: value.gender, avatar: "" };
}

export function findPossibleDuplicates(nodes, data) {
  const name = fold([data["first name"], data["last name"]].filter(Boolean).join(" "));
  return name ? nodes.filter(person => fold([person.data?.["first name"], person.data?.["last name"]].filter(Boolean).join(" ")) === name) : [];
}

// Adds records/edges to a complete copy. No existing field, permission, id or
// relationship is replaced; the existing page Save remains the only writer.
export function applyFamilyEdit(nodes, request, { createId = () => "person_" + globalThis.crypto.randomUUID() } = {}) {
  assertGraph(nodes);
  if (!request || !TYPES.has(request.type) || Object.keys(request).some(key => ![
    "type", "anchorId", "personId", "newPerson", "sharedParentIds", "otherParentId", "allowDuplicate"
  ].includes(key)) || (request.allowDuplicate !== undefined && typeof request.allowDuplicate !== "boolean")) fail("INVALID_REQUEST", "Zahtjev za povezivanje nije valjan.");
  const hasNew = Object.hasOwn(request, "newPerson");
  if (hasNew === Object.hasOwn(request, "personId") || (request.type === "standalone" && (!hasNew || request.anchorId !== undefined))) {
    fail("INVALID_REQUEST", "Odaberi postojeću osobu ili unesi novu.");
  }
  if ((request.type !== "sibling" && request.sharedParentIds !== undefined) || (request.type !== "child" && request.otherParentId !== undefined)) {
    fail("INVALID_REQUEST", "Odabrana vrsta veze nije valjana.");
  }
  const result = structuredClone(nodes);
  const byId = new Map(result.map(person => [person.id, person]));
  const anchor = byId.get(request.anchorId);
  if (request.type !== "standalone" && !anchor) fail("MISSING_PERSON", "Početna osoba više nije u nacrtu. Ponovno otvori njezin profil.");
  let target;
  if (hasNew) {
    const data = personData(request.newPerson);
    if (findPossibleDuplicates(nodes, data).length && request.allowDuplicate !== true) fail("POSSIBLE_DUPLICATE", "Postoji osoba istog imena. Odaberi postojeću osobu ili izričito potvrdi novi unos.");
    const id = createId();
    if (typeof id !== "string" || !id.trim() || id !== id.trim() || /^tmp_/i.test(id) || byId.has(id)) fail("INVALID_ID", "Nova oznaka osobe nije valjana. Pokušaj ponovno.");
    target = { id, data, rels: { parents: [], spouses: [], children: [] }, privacy: { publicAnchor: false } };
    result.push(target); byId.set(id, target);
  } else {
    target = byId.get(request.personId);
    if (!target) fail("MISSING_PERSON", "Odabrana osoba više nije u nacrtu. Ponovno je pronađi.");
  }
  if (anchor && anchor.id === target.id) fail("SELF_RELATION", "Osobu ne možeš povezati samu sa sobom.");
  let changed = hasNew;
  function connect(first, key, second, reverse) {
    if (!first || !second) fail("MISSING_PERSON", "Odabrana osoba više nije u nacrtu.");
    if (first.id === second.id) fail("SELF_RELATION", "Osobu ne možeš povezati samu sa sobom.");
    if (!first.rels[key].includes(second.id)) { first.rels[key].push(second.id); second.rels[reverse].push(first.id); changed = true; }
  }
  if (request.type === "parent") connect(target, "children", anchor, "parents");
  if (request.type === "partner") connect(anchor, "spouses", target, "spouses");
  if (request.type === "child") {
    connect(anchor, "children", target, "parents");
    if (request.otherParentId) {
      if (request.otherParentId === anchor.id) fail("SELF_RELATION", "Drugi roditelj mora biti druga osoba.");
      connect(byId.get(request.otherParentId), "children", target, "parents");
    }
  }
  if (request.type === "sibling") {
    const parents = request.sharedParentIds;
    if (!Array.isArray(parents) || !parents.length || new Set(parents).size !== parents.length || parents.some(id => !anchor.rels.parents.includes(id))) {
      fail("SHARED_PARENT_REQUIRED", "Odaberi barem jednog zajedničkog roditelja koji je već upisan u početnom profilu.");
    }
    for (const id of parents) connect(byId.get(id), "children", target, "parents");
  }
  assertGraph(result);
  if (!changed) fail("NO_CHANGE", "Ta je veza već upisana. Stablo nije promijenjeno.");
  return { nodes: result, personId: target.id };
}
