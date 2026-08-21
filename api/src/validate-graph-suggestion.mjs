const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const TEMPORARY_ID_PATTERN = /^tmp_[1-9][0-9]{0,3}$/;
const RELATIONSHIP_TYPES = new Set(["parentOf", "spouseOf"]);
const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "type",
  "anchorPersonId",
  "anchorCatalogVersion",
  "sourceRevision",
  "people",
  "relationships",
  "comment",
  "submitterName",
  "email",
  "relationship",
  "accessCode"
]);
const PERSON_KEYS = new Set(["id", "firstName", "lastName", "birthday", "gender"]);
const RELATIONSHIP_KEYS = new Set(["from", "to", "type"]);

export const GRAPH_LIMITS = Object.freeze({
  people: 50,
  relationships: 100,
  anchorId: 200,
  firstName: 100,
  lastName: 100,
  birthday: 40,
  comment: 2_000,
  submitterName: 100,
  email: 254,
  submitterRelationship: 120
});

export class GraphSuggestionValidationError extends Error {
  constructor(category, statusCode = 400) {
    super(statusCode === 409 ? "Stale anchor catalog" : "Invalid request");
    this.name = "GraphSuggestionValidationError";
    this.category = category;
    this.statusCode = statusCode;
  }
}

/**
 * Validate and normalize an additive-only graph suggestion. The generated
 * allowlist is authoritative; the public browser catalog is not.
 */
export function validateGraphSuggestion(payload, allowlist) {
  requirePlainObject(payload, "request_shape");
  rejectUnknownKeys(payload, TOP_LEVEL_KEYS, "unknown_top_level_key");
  validateAllowlist(allowlist);

  if (payload.schemaVersion !== 1) fail("unsupported_schema_version");
  if (payload.type !== "graph") fail("unsupported_suggestion_type");

  const anchorPersonId = cleanId(payload.anchorPersonId, "invalid_anchor");
  if (/^tmp_/i.test(anchorPersonId)) fail("temporary_anchor");
  if (anchorPersonId.length > GRAPH_LIMITS.anchorId) fail("invalid_anchor");

  const anchorCatalogVersion = requireRevision(payload.anchorCatalogVersion, "invalid_catalog_version");
  if (anchorCatalogVersion !== allowlist.catalogVersion) {
    fail("stale_anchor_catalog", 409);
  }
  if (!allowlist.anchorIds.includes(anchorPersonId)) fail("unknown_anchor");
  const sourceRevision = requireRevision(payload.sourceRevision, "invalid_source_revision");

  if (!Array.isArray(payload.people) || payload.people.length === 0) {
    fail("people_required");
  }
  if (payload.people.length > GRAPH_LIMITS.people) fail("too_many_people");
  if (!Array.isArray(payload.relationships)) fail("relationships_not_array");
  if (payload.relationships.length > GRAPH_LIMITS.relationships) fail("too_many_relationships");

  const people = [];
  const temporaryIds = new Set();
  for (const rawPerson of payload.people) {
    requirePlainObject(rawPerson, "invalid_person");
    rejectUnknownKeys(rawPerson, PERSON_KEYS, "unknown_person_key");
    if (typeof rawPerson.id !== "string" || !TEMPORARY_ID_PATTERN.test(rawPerson.id)) {
      fail("invalid_temporary_id");
    }
    if (temporaryIds.has(rawPerson.id)) fail("duplicate_temporary_id");
    temporaryIds.add(rawPerson.id);

    people.push({
      id: rawPerson.id,
      firstName: cleanText(rawPerson.firstName, GRAPH_LIMITS.firstName, {
        required: true,
        category: "invalid_person"
      }),
      lastName: cleanText(rawPerson.lastName, GRAPH_LIMITS.lastName, {
        category: "invalid_person"
      }),
      birthday: cleanText(rawPerson.birthday, GRAPH_LIMITS.birthday, {
        category: "invalid_person"
      }),
      gender: requireGender(rawPerson.gender)
    });
  }

  const allowedEndpoints = new Set([anchorPersonId, ...temporaryIds]);
  const relationshipKeys = new Set();
  const relationships = [];
  for (const rawRelationship of payload.relationships) {
    requirePlainObject(rawRelationship, "invalid_relationship");
    rejectUnknownKeys(rawRelationship, RELATIONSHIP_KEYS, "unknown_relationship_key");
    if (!RELATIONSHIP_TYPES.has(rawRelationship.type)) fail("unsupported_relationship");

    const from = cleanId(rawRelationship.from, "invalid_relationship");
    const to = cleanId(rawRelationship.to, "invalid_relationship");
    if (from === to) fail("self_relationship");
    if (!allowedEndpoints.has(from) || !allowedEndpoints.has(to)) fail("dangling_endpoint");
    if (!temporaryIds.has(from) && !temporaryIds.has(to)) fail("canonical_to_canonical_relationship");

    const normalized = rawRelationship.type === "spouseOf" && from > to
      ? { from: to, to: from, type: rawRelationship.type }
      : { from, to, type: rawRelationship.type };
    const key = `${normalized.type}:${normalized.from}:${normalized.to}`;
    if (relationshipKeys.has(key)) fail("duplicate_relationship");
    relationshipKeys.add(key);
    relationships.push(normalized);
  }

  validateConnectedness(anchorPersonId, temporaryIds, relationships);
  validateParentCounts(anchorPersonId, temporaryIds, relationships);
  validateAncestry(anchorPersonId, temporaryIds, relationships);

  const submitterName = cleanText(payload.submitterName, GRAPH_LIMITS.submitterName, {
    required: true,
    category: "invalid_submitter"
  });
  const email = cleanText(payload.email, GRAPH_LIMITS.email, { category: "invalid_submitter" });
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail("invalid_submitter");

  return {
    submitter: {
      name: submitterName,
      email,
      relationship: cleanText(payload.relationship, GRAPH_LIMITS.submitterRelationship, {
        category: "invalid_submitter"
      })
    },
    payload: {
      anchorPersonId,
      anchorCatalogVersion,
      sourceRevision,
      people,
      relationships,
      comment: cleanText(payload.comment, GRAPH_LIMITS.comment, { category: "invalid_comment" })
    }
  };
}

function validateAllowlist(allowlist) {
  if (!isPlainObject(allowlist)
    || !REVISION_PATTERN.test(allowlist.catalogVersion ?? "")
    || !Array.isArray(allowlist.anchorIds)
    || allowlist.anchorIds.some((id) => typeof id !== "string" || !id || /^tmp_/i.test(id))
    || new Set(allowlist.anchorIds).size !== allowlist.anchorIds.length) {
    throw new Error("Generated public anchor allowlist is invalid.");
  }
}

function validateConnectedness(anchorId, temporaryIds, relationships) {
  const adjacency = new Map([anchorId, ...temporaryIds].map((id) => [id, []]));
  for (const edge of relationships) {
    adjacency.get(edge.from).push(edge.to);
    adjacency.get(edge.to).push(edge.from);
  }
  const visited = new Set();
  const queue = [anchorId];
  while (queue.length > 0) {
    const id = queue.shift();
    if (visited.has(id)) continue;
    visited.add(id);
    queue.push(...adjacency.get(id).filter((next) => !visited.has(next)));
  }
  if ([...temporaryIds].some((id) => !visited.has(id))) fail("disconnected_person");
}

function validateParentCounts(anchorId, temporaryIds, relationships) {
  const parentCounts = new Map([anchorId, ...temporaryIds].map((id) => [id, 0]));
  for (const edge of relationships) {
    if (edge.type !== "parentOf") continue;
    parentCounts.set(edge.to, parentCounts.get(edge.to) + 1);
  }
  if ([...parentCounts.values()].some((count) => count > 2)) fail("too_many_parents");
}

function validateAncestry(anchorId, temporaryIds, relationships) {
  const children = new Map([anchorId, ...temporaryIds].map((id) => [id, []]));
  for (const edge of relationships) {
    if (edge.type === "parentOf") children.get(edge.from).push(edge.to);
  }
  const state = new Map();
  function visit(id) {
    if (state.get(id) === 1) fail("ancestry_cycle");
    if (state.get(id) === 2) return;
    state.set(id, 1);
    for (const childId of children.get(id)) visit(childId);
    state.set(id, 2);
  }
  for (const id of children.keys()) visit(id);
}

function requireGender(value) {
  if (value !== "M" && value !== "F") fail("invalid_gender");
  return value;
}

function requireRevision(value, category) {
  if (typeof value !== "string" || !REVISION_PATTERN.test(value)) fail(category);
  return value;
}

function cleanId(value, category) {
  if (typeof value !== "string" || !value || value !== value.trim()) fail(category);
  return value;
}

function cleanText(value, maximum, { required = false, category } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(category);
    return "";
  }
  if (typeof value !== "string") fail(category);
  const cleaned = value.replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim();
  if ((required && !cleaned) || cleaned.length > maximum) fail(category);
  return cleaned;
}

function rejectUnknownKeys(value, allowed, category) {
  if (Object.keys(value).some((key) => !allowed.has(key))) fail(category);
}

function requirePlainObject(value, category) {
  if (!isPlainObject(value)) fail(category);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(category, statusCode = 400) {
  throw new GraphSuggestionValidationError(category, statusCode);
}
