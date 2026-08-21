const TEMPORARY_ID_PATTERN = /^tmp_[1-9][0-9]{0,3}$/;
const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const RELATIONSHIP_TYPES = new Set(["parentOf", "spouseOf"]);
const PERSON_KEYS = Object.freeze(["firstName", "lastName", "birthday", "gender"]);
const PERSON_LIMITS = Object.freeze({
  firstName: 100,
  lastName: 100,
  birthday: 40
});
export const VISUAL_DRAFT_LIMITS = Object.freeze({
  people: 50,
  relationships: 100
});

export class DraftValidationError extends Error {
  constructor(issues) {
    const detail = issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n");
    super(`Visual suggestion draft is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${detail}`);
    this.name = "DraftValidationError";
    this.issues = [...issues];
  }
}

export class DraftMutationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "DraftMutationError";
    this.code = code;
    this.details = clone(details);
  }
}

export class VisualSuggestionDraft {
  #state;
  #nextTemporaryId;

  constructor() {
    this.#state = createEmptyState();
    this.#nextTemporaryId = 1;
  }

  getSnapshot() {
    return deepFreeze(clone(this.#state));
  }

  hasContent() {
    return this.#state.anchorPersonId !== null;
  }

  hasProposedPeople() {
    return this.#state.people.length > 0;
  }

  selectAnchor(anchor, { anchorCatalogVersion, sourceRevision }) {
    if (this.hasContent()) {
      throw new DraftMutationError(
        "DRAFT_NOT_EMPTY",
        "Reset the current visual draft before selecting another anchor."
      );
    }

    const anchorPersonId = requireCanonicalAnchorId(anchor?.id);
    const candidate = {
      ...createEmptyState(),
      anchorPersonId,
      anchorCatalogVersion: requireRevision(anchorCatalogVersion, "anchorCatalogVersion"),
      sourceRevision: requireRevision(sourceRevision, "sourceRevision")
    };
    this.#commit(candidate);
    return this.getSnapshot();
  }

  addChild(relativeId, person) {
    return this.#addRelatedPerson(relativeId, "child", person);
  }

  addParent(relativeId, person) {
    return this.#addRelatedPerson(relativeId, "parent", person);
  }

  addSpouse(relativeId, person) {
    return this.#addRelatedPerson(relativeId, "spouse", person);
  }

  addRelationship(from, to, type) {
    this.#requireSelectedAnchor();
    const relationship = normalizeRelationship({ from, to, type });
    const candidate = clone(this.#state);
    candidate.relationships.push(relationship);
    this.#commit(candidate);
    return this.getSnapshot();
  }

  editPerson(personId, changes) {
    this.#requireTemporaryPerson(personId, "edit");
    const cleanChanges = normalizePersonChanges(changes);
    const candidate = clone(this.#state);
    const person = candidate.people.find((entry) => entry.id === personId);
    Object.assign(person, cleanChanges);
    validatePerson(person, personId);
    this.#commit(candidate);
    return deepFreeze(clone(person));
  }

  analyzeRemoval(personId) {
    this.#requireTemporaryPerson(personId, "remove");
    const relationships = this.#state.relationships.filter(
      (relationship) => relationship.from !== personId && relationship.to !== personId
    );
    const remainingIds = this.#state.people
      .map((person) => person.id)
      .filter((id) => id !== personId);
    const reachable = connectedIdsFromAnchor(
      this.#state.anchorPersonId,
      remainingIds,
      relationships
    );
    const disconnectedPersonIds = remainingIds.filter((id) => !reachable.has(id));

    return deepFreeze({
      personId,
      disconnectedPersonIds,
      removedRelationshipCount: this.#state.relationships.length - relationships.length
    });
  }

  removePerson(personId, { cascade = false } = {}) {
    const analysis = this.analyzeRemoval(personId);
    if (analysis.disconnectedPersonIds.length > 0 && !cascade) {
      throw new DraftMutationError(
        "DISCONNECTED_AFTER_REMOVE",
        `Removing "${personId}" would disconnect ${analysis.disconnectedPersonIds.length} proposed person${analysis.disconnectedPersonIds.length === 1 ? "" : "s"}.`,
        analysis
      );
    }

    const removedIds = new Set([
      personId,
      ...(cascade ? analysis.disconnectedPersonIds : [])
    ]);
    const candidate = clone(this.#state);
    candidate.people = candidate.people.filter((person) => !removedIds.has(person.id));
    candidate.relationships = candidate.relationships.filter(
      (relationship) => !removedIds.has(relationship.from) && !removedIds.has(relationship.to)
    );
    this.#commit(candidate);

    return deepFreeze({
      removedPersonIds: [...removedIds],
      draft: clone(this.#state)
    });
  }

  serialize() {
    this.#requireSelectedAnchor();
    if (!this.hasProposedPeople()) {
      throw new DraftMutationError("PERSON_REQUIRED", "Add at least one proposed person before continuing.");
    }
    validateVisualDraft(this.#state);
    return deepFreeze({
      schemaVersion: 1,
      type: "graph",
      anchorPersonId: this.#state.anchorPersonId,
      anchorCatalogVersion: this.#state.anchorCatalogVersion,
      sourceRevision: this.#state.sourceRevision,
      people: clone(this.#state.people),
      relationships: clone(this.#state.relationships)
    });
  }

  reset() {
    this.#state = createEmptyState();
    this.#nextTemporaryId = 1;
    return this.getSnapshot();
  }

  #addRelatedPerson(relativeId, relationshipKind, personInput) {
    this.#requireSelectedAnchor();
    this.#requireEndpoint(relativeId);
    if (this.#state.people.length >= VISUAL_DRAFT_LIMITS.people) {
      throw new DraftMutationError(
        "PEOPLE_LIMIT",
        `A visual suggestion may contain at most ${VISUAL_DRAFT_LIMITS.people} proposed people.`
      );
    }
    const id = `tmp_${this.#nextTemporaryId}`;
    const person = { id, ...normalizeNewPerson(personInput) };
    const relationship = relationshipForNewPerson(relativeId, id, relationshipKind);
    const candidate = clone(this.#state);
    candidate.people.push(person);
    candidate.relationships.push(relationship);
    this.#commit(candidate);
    this.#nextTemporaryId += 1;
    return deepFreeze(clone(person));
  }

  #commit(candidate) {
    validateVisualDraft(candidate);
    this.#state = clone(candidate);
  }

  #requireSelectedAnchor() {
    if (!this.#state.anchorPersonId) {
      throw new DraftMutationError("ANCHOR_REQUIRED", "Choose an approved public anchor first.");
    }
  }

  #requireEndpoint(personId) {
    if (personId === this.#state.anchorPersonId) return;
    if (this.#state.people.some((person) => person.id === personId)) return;
    throw new DraftMutationError("UNKNOWN_PERSON", `Draft person "${personId}" does not exist.`);
  }

  #requireTemporaryPerson(personId, action) {
    if (personId === this.#state.anchorPersonId) {
      throw new DraftMutationError(
        "ANCHOR_IMMUTABLE",
        `The canonical anchor cannot be ${action === "edit" ? "edited" : "removed"}.`
      );
    }
    if (!TEMPORARY_ID_PATTERN.test(personId) || !this.#state.people.some((person) => person.id === personId)) {
      throw new DraftMutationError("UNKNOWN_PERSON", `Proposed person "${personId}" does not exist.`);
    }
  }
}

export function validateVisualDraft(draft) {
  const issues = [];

  if (!isPlainObject(draft)) {
    throw new DraftValidationError(["Draft must be an object."]);
  }

  if (draft.schemaVersion !== 1) {
    issues.push("schemaVersion must be 1.");
  }
  if (!Array.isArray(draft.people)) issues.push("people must be an array.");
  if (!Array.isArray(draft.relationships)) issues.push("relationships must be an array.");
  if (Array.isArray(draft.people) && draft.people.length > VISUAL_DRAFT_LIMITS.people) {
    issues.push(`A visual suggestion may contain at most ${VISUAL_DRAFT_LIMITS.people} proposed people.`);
  }
  if (Array.isArray(draft.relationships)
    && draft.relationships.length > VISUAL_DRAFT_LIMITS.relationships) {
    issues.push(`A visual suggestion may contain at most ${VISUAL_DRAFT_LIMITS.relationships} relationships.`);
  }

  const anchorSelected = draft.anchorPersonId !== null;
  if (!anchorSelected) {
    if (draft.anchorCatalogVersion !== null || draft.sourceRevision !== null) {
      issues.push("An unselected draft may not contain catalog or source revisions.");
    }
    if (Array.isArray(draft.people) && draft.people.length > 0) {
      issues.push("An unselected draft may not contain proposed people.");
    }
    if (Array.isArray(draft.relationships) && draft.relationships.length > 0) {
      issues.push("An unselected draft may not contain relationships.");
    }
  } else {
    try {
      requireCanonicalAnchorId(draft.anchorPersonId);
    } catch (error) {
      issues.push(error.message);
    }
    for (const [value, label] of [
      [draft.anchorCatalogVersion, "anchorCatalogVersion"],
      [draft.sourceRevision, "sourceRevision"]
    ]) {
      try {
        requireRevision(value, label);
      } catch (error) {
        issues.push(error.message);
      }
    }
  }

  const peopleById = new Map();
  if (Array.isArray(draft.people)) {
    draft.people.forEach((person, index) => {
      const label = `Proposed person at index ${index}`;
      if (!isPlainObject(person)) {
        issues.push(`${label} must be an object.`);
        return;
      }
      const actualKeys = Object.keys(person).sort();
      const expectedKeys = ["birthday", "firstName", "gender", "id", "lastName"];
      if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys)) {
        issues.push(`${label} must contain only id, firstName, lastName, birthday, and gender.`);
      }
      if (typeof person.id !== "string" || !TEMPORARY_ID_PATTERN.test(person.id)) {
        issues.push(`${label} id must use the draft-only tmp_<number> namespace.`);
      } else if (peopleById.has(person.id)) {
        issues.push(`Duplicate proposed person id "${person.id}".`);
      } else {
        peopleById.set(person.id, person);
      }
      try {
        validatePerson(person, person.id || label);
      } catch (error) {
        issues.push(error.message);
      }
    });
  }

  const normalizedRelationships = [];
  const relationshipKeys = new Set();
  if (Array.isArray(draft.relationships)) {
    draft.relationships.forEach((relationship, index) => {
      const label = `Relationship at index ${index}`;
      if (!isPlainObject(relationship)) {
        issues.push(`${label} must be an object.`);
        return;
      }
      const actualKeys = Object.keys(relationship).sort();
      if (JSON.stringify(actualKeys) !== JSON.stringify(["from", "to", "type"])) {
        issues.push(`${label} must contain only from, to, and type.`);
      }
      let normalized;
      try {
        normalized = normalizeRelationship(relationship);
      } catch (error) {
        issues.push(`${label}: ${error.message}`);
        return;
      }
      if (normalized.type === "spouseOf"
        && (relationship.from !== normalized.from || relationship.to !== normalized.to)) {
        issues.push(`${label} spouseOf endpoints must use normalized lexical order.`);
      }

      for (const endpoint of [normalized.from, normalized.to]) {
        if (endpoint !== draft.anchorPersonId && !peopleById.has(endpoint)) {
          issues.push(`${label} references disallowed or missing endpoint "${endpoint}"; the selected anchor is the only canonical id allowed.`);
        }
      }

      const key = relationshipKey(normalized);
      if (relationshipKeys.has(key)) {
        issues.push(`${label} duplicates relationship "${key}".`);
      }
      relationshipKeys.add(key);
      normalizedRelationships.push(normalized);
    });
  }

  if (anchorSelected && Array.isArray(draft.people) && Array.isArray(draft.relationships)) {
    validateConnectedness(draft.anchorPersonId, [...peopleById.keys()], normalizedRelationships, issues);
    validateParentCounts(draft.anchorPersonId, peopleById, normalizedRelationships, issues);
    validateAncestryCycles(draft.anchorPersonId, peopleById, normalizedRelationships, issues);
  }

  if (issues.length > 0) throw new DraftValidationError(issues);
  return {
    anchorPersonId: draft.anchorPersonId,
    personCount: peopleById.size,
    relationshipCount: normalizedRelationships.length
  };
}

function createEmptyState() {
  return {
    schemaVersion: 1,
    anchorPersonId: null,
    anchorCatalogVersion: null,
    sourceRevision: null,
    people: [],
    relationships: []
  };
}

function normalizeNewPerson(input) {
  if (!isPlainObject(input)) {
    throw new DraftMutationError("INVALID_PERSON", "Proposed person fields must be an object.");
  }
  rejectUnknownKeys(input, PERSON_KEYS, "Proposed person");
  const person = {
    firstName: normalizeText(input.firstName, "firstName", PERSON_LIMITS.firstName, { required: true }),
    lastName: normalizeText(input.lastName, "lastName", PERSON_LIMITS.lastName),
    birthday: normalizeText(input.birthday, "birthday", PERSON_LIMITS.birthday),
    gender: normalizeGender(input.gender)
  };
  validatePerson({ id: "tmp_1", ...person }, "new person");
  return person;
}

function normalizePersonChanges(changes) {
  if (!isPlainObject(changes)) {
    throw new DraftMutationError("INVALID_PERSON", "Person changes must be an object.");
  }
  rejectUnknownKeys(changes, PERSON_KEYS, "Person changes");
  const normalized = {};
  for (const key of Object.keys(changes)) {
    normalized[key] = key === "gender"
      ? normalizeGender(changes[key])
      : normalizeText(changes[key], key, PERSON_LIMITS[key], { required: key === "firstName" });
  }
  return normalized;
}

function validatePerson(person, label) {
  for (const key of PERSON_KEYS) {
    if (typeof person[key] !== "string") {
      throw new DraftMutationError("INVALID_PERSON", `Person "${label}" ${key} must be a string.`);
    }
  }
  if (!person.firstName.trim()) {
    throw new DraftMutationError("INVALID_PERSON", `Person "${label}" firstName is required.`);
  }
  for (const [key, limit] of Object.entries(PERSON_LIMITS)) {
    if (person[key].length > limit) {
      throw new DraftMutationError("INVALID_PERSON", `Person "${label}" ${key} exceeds ${limit} characters.`);
    }
  }
  if (!new Set(["M", "F"]).has(person.gender)) {
    throw new DraftMutationError("INVALID_PERSON", `Person "${label}" gender must be "M" or "F".`);
  }
}

function normalizeText(value, label, maximum, { required = false } = {}) {
  if (value === undefined && !required) return "";
  if (typeof value !== "string") {
    throw new DraftMutationError("INVALID_PERSON", `${label} must be a string.`);
  }
  const normalized = value.trim();
  if (required && !normalized) {
    throw new DraftMutationError("INVALID_PERSON", `${label} is required.`);
  }
  if (normalized.length > maximum) {
    throw new DraftMutationError("INVALID_PERSON", `${label} exceeds ${maximum} characters.`);
  }
  return normalized;
}

function normalizeGender(value) {
  if (typeof value !== "string" || !new Set(["M", "F"]).has(value)) {
    throw new DraftMutationError("INVALID_PERSON", "gender must be \"M\" or \"F\".");
  }
  return value;
}

function normalizeRelationship({ from, to, type }) {
  if (typeof from !== "string" || !from.trim() || typeof to !== "string" || !to.trim()) {
    throw new DraftMutationError("INVALID_RELATIONSHIP", "Relationship endpoints must be non-empty string ids.");
  }
  if (from !== from.trim() || to !== to.trim()) {
    throw new DraftMutationError("INVALID_RELATIONSHIP", "Relationship endpoint ids may not contain leading or trailing whitespace.");
  }
  if (from === to) {
    throw new DraftMutationError("SELF_RELATIONSHIP", `A person cannot have a ${type} relationship with themselves.`);
  }
  if (!RELATIONSHIP_TYPES.has(type)) {
    throw new DraftMutationError("INVALID_RELATIONSHIP", `Unsupported relationship type "${type}".`);
  }
  if (type === "spouseOf" && from > to) {
    return { from: to, to: from, type };
  }
  return { from, to, type };
}

function relationshipForNewPerson(relativeId, newPersonId, kind) {
  if (kind === "child") return { from: relativeId, to: newPersonId, type: "parentOf" };
  if (kind === "parent") return { from: newPersonId, to: relativeId, type: "parentOf" };
  if (kind === "spouse") return normalizeRelationship({ from: relativeId, to: newPersonId, type: "spouseOf" });
  throw new DraftMutationError("INVALID_RELATIONSHIP", `Unsupported relative action "${kind}".`);
}

function validateConnectedness(anchorId, personIds, relationships, issues) {
  const reachable = connectedIdsFromAnchor(anchorId, personIds, relationships);
  const disconnected = personIds.filter((id) => !reachable.has(id));
  if (disconnected.length > 0) {
    issues.push(`Every proposed person must remain connected to the anchor; disconnected: ${disconnected.join(", ")}.`);
  }
}

function connectedIdsFromAnchor(anchorId, personIds, relationships) {
  const allowed = new Set([anchorId, ...personIds]);
  const adjacency = new Map([...allowed].map((id) => [id, []]));
  for (const relationship of relationships) {
    if (!allowed.has(relationship.from) || !allowed.has(relationship.to)) continue;
    adjacency.get(relationship.from).push(relationship.to);
    adjacency.get(relationship.to).push(relationship.from);
  }
  const visited = new Set();
  const queue = anchorId ? [anchorId] : [];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...(adjacency.get(id) ?? []).filter((next) => !visited.has(next)));
  }
  return visited;
}

function validateParentCounts(anchorId, peopleById, relationships, issues) {
  const counts = new Map([[anchorId, 0], ...[...peopleById.keys()].map((id) => [id, 0])]);
  for (const relationship of relationships) {
    if (relationship.type !== "parentOf" || !counts.has(relationship.to)) continue;
    counts.set(relationship.to, counts.get(relationship.to) + 1);
  }
  for (const [id, count] of counts) {
    if (count > 2) issues.push(`Person "${id}" has ${count} proposed parents; maximum is 2.`);
  }
}

function validateAncestryCycles(anchorId, peopleById, relationships, issues) {
  const ids = [anchorId, ...peopleById.keys()];
  const children = new Map(ids.map((id) => [id, []]));
  for (const relationship of relationships) {
    if (relationship.type === "parentOf"
      && children.has(relationship.from)
      && children.has(relationship.to)) {
      children.get(relationship.from).push(relationship.to);
    }
  }
  const state = new Map();
  const stack = [];
  let cycle = null;

  function visit(id) {
    if (cycle) return;
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      const start = stack.indexOf(id);
      cycle = [...stack.slice(start), id];
      return;
    }
    state.set(id, 1);
    stack.push(id);
    for (const childId of children.get(id) ?? []) visit(childId);
    stack.pop();
    state.set(id, 2);
  }

  for (const id of ids) visit(id);
  if (cycle) issues.push(`Parent/child ancestry cycle detected: ${cycle.join(" -> ")}.`);
}

function requireCanonicalAnchorId(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new DraftMutationError("INVALID_ANCHOR", "Anchor id must be a non-empty canonical string id.");
  }
  if (value !== value.trim()) {
    throw new DraftMutationError("INVALID_ANCHOR", "Anchor id may not contain leading or trailing whitespace.");
  }
  if (TEMPORARY_ID_PATTERN.test(value) || /^tmp_/i.test(value)) {
    throw new DraftMutationError("INVALID_ANCHOR", "Anchor id may not use the temporary tmp_* namespace.");
  }
  return value;
}

function requireRevision(value, label) {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
    throw new DraftMutationError("INVALID_REVISION", `${label} must use sha256:<64 lowercase hex characters>.`);
  }
  return value;
}

function relationshipKey(relationship) {
  return `${relationship.type}:${relationship.from}:${relationship.to}`;
}

function rejectUnknownKeys(value, allowedKeys, label) {
  const allowed = new Set(allowedKeys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) {
      throw new DraftMutationError("INVALID_PERSON", `${label} contains unsupported field "${key}".`);
    }
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
