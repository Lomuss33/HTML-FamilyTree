import { validateVisualDraft } from "../suggestions/draft-model.js";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;

export function createFamilyAdditionsPatch(suggestion, currentRevision = null) {
  if (!isPlainObject(suggestion) || suggestion.type !== "graph" || !UUID_PATTERN.test(suggestion.id ?? "")) {
    throw new Error("A valid stored graph suggestion is required.");
  }
  const payload = suggestion.payload;
  validateVisualDraft({
    schemaVersion: 1,
    anchorPersonId: payload?.anchorPersonId,
    anchorCatalogVersion: payload?.anchorCatalogVersion,
    sourceRevision: payload?.sourceRevision,
    people: payload?.people,
    relationships: payload?.relationships
  });
  if (currentRevision) assertCurrentRevision(payload, currentRevision);

  const suggestionKey = suggestion.id.replaceAll("-", "").toLowerCase();
  const sortedPeople = [...payload.people].sort((left, right) => temporaryNumber(left.id) - temporaryNumber(right.id));
  const idMap = new Map(sortedPeople.map((person, index) => [person.id, `sg_${suggestionKey}_${index + 1}`]));
  const mapEndpoint = (id) => id === payload.anchorPersonId ? id : idMap.get(id);

  const addPeople = sortedPeople.map((person) => ({
    id: idMap.get(person.id),
    data: {
      "first name": person.firstName,
      "last name": person.lastName,
      birthday: person.birthday,
      gender: person.gender
    },
    rels: {
      parents: [],
      children: [],
      spouses: []
    }
  }));

  const addRelationships = payload.relationships
    .map((relationship) => ({
      from: mapEndpoint(relationship.from),
      to: mapEndpoint(relationship.to),
      type: relationship.type
    }))
    .sort(compareRelationships);

  return deepFreeze({
    schemaVersion: 1,
    type: "family-additions",
    suggestionId: suggestion.id,
    anchorPersonId: payload.anchorPersonId,
    anchorCatalogVersion: payload.anchorCatalogVersion,
    sourceRevision: payload.sourceRevision,
    addPeople,
    addRelationships
  });
}

export function assertCurrentRevision(payload, currentRevision) {
  if (!isPlainObject(currentRevision)
    || !REVISION_PATTERN.test(currentRevision.catalogVersion ?? "")
    || !REVISION_PATTERN.test(currentRevision.sourceRevision ?? "")) {
    throw new Error("Current canonical revision metadata is invalid.");
  }
  if (payload?.anchorCatalogVersion !== currentRevision.catalogVersion
    || payload?.sourceRevision !== currentRevision.sourceRevision) {
    throw new Error("This graph suggestion targets a stale family revision and cannot be accepted.");
  }
}

export function serializeFamilyAdditionsPatch(patch) {
  return `${JSON.stringify(patch, null, 2)}\n`;
}

function temporaryNumber(id) {
  const match = /^tmp_([1-9][0-9]{0,3})$/.exec(id ?? "");
  if (!match) throw new Error("Patch contains an invalid temporary person id.");
  return Number(match[1]);
}

function compareRelationships(left, right) {
  const leftKey = `${left.type}\u0000${left.from}\u0000${left.to}`;
  const rightKey = `${right.type}\u0000${right.from}\u0000${right.to}`;
  return leftKey.localeCompare(rightKey, "en");
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
}
