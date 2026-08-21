import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const RELATION_KEYS = Object.freeze(["parents", "children", "spouses"]);
const SUPPORTED_GENDERS = new Set(["M", "F"]);
const SUPPORTED_STRING_FIELDS = Object.freeze([
  "first name",
  "last name",
  "birthday",
  "avatar"
]);
const PRIVACY_KEYS = new Set([
  "publicAnchor",
  "publicLabel",
  "publicLifespan",
  "publicBranchLabel"
]);
const INTERNAL_PERSON_KEYS = new Set([
  "_new_rel_data",
  "main",
  "to_add",
  "unknown"
]);
const TEMPORARY_ID_PATTERN = /^tmp_/i;

export class FamilyDataValidationError extends Error {
  constructor(issues) {
    const detail = issues.map((issue, index) => `${index + 1}. ${issue}`).join("\n");
    super(`Canonical family data is invalid (${issues.length} issue${issues.length === 1 ? "" : "s"}):\n${detail}`);
    this.name = "FamilyDataValidationError";
    this.issues = [...issues];
  }
}

/**
 * Strictly validates the persisted canonical family array without mutating it.
 * Returns basic validated metadata or throws FamilyDataValidationError.
 */
export function validateFamilyData(family, { mainPersonId } = {}) {
  const issues = [];

  if (!Array.isArray(family) || family.length === 0) {
    throw new FamilyDataValidationError(["The canonical root must be a non-empty array of people."]);
  }

  const peopleById = new Map();

  family.forEach((person, index) => {
    const location = `Person at index ${index}`;
    if (!isPlainObject(person)) {
      issues.push(`${location} must be an object.`);
      return;
    }

    const id = person.id;
    if (typeof id !== "string" || !id.trim()) {
      issues.push(`${location} must have a non-empty string id.`);
    } else {
      if (id !== id.trim()) {
        issues.push(`${location} has id "${id}" with leading or trailing whitespace.`);
      }
      if (TEMPORARY_ID_PATTERN.test(id)) {
        issues.push(`Person "${id}" uses the reserved visual-suggestion temporary id namespace "tmp_*".`);
      }
      if (peopleById.has(id)) {
        issues.push(`Duplicate canonical person id "${id}".`);
      } else {
        peopleById.set(id, person);
      }
    }

    validatePersonShape(person, id || location, issues);
  });

  for (const [id, person] of peopleById) {
    validateRelationshipEndpoints(id, person, peopleById, issues);
  }

  for (const [id, person] of peopleById) {
    validateReciprocalRelationships(id, person, peopleById, issues);
  }

  validateAncestryCycles(peopleById, issues);

  const resolvedMainPersonId = mainPersonId ?? family[0]?.id;
  if (mainPersonId !== undefined && (typeof mainPersonId !== "string" || !mainPersonId.trim())) {
    issues.push("Configured mainPersonId must be a non-empty string when provided.");
  } else if (typeof resolvedMainPersonId === "string" && !peopleById.has(resolvedMainPersonId)) {
    issues.push(`Configured/default main person "${resolvedMainPersonId}" does not exist.`);
  }

  if (issues.length > 0) {
    throw new FamilyDataValidationError(issues);
  }

  return {
    personCount: family.length,
    mainPersonId: resolvedMainPersonId
  };
}

/**
 * A deterministic revision of merge-relevant canonical state. Private display
 * fields are deliberately excluded: the digest covers the default main id,
 * canonical ids, and normalized relationship topology only.
 */
export function computeCanonicalSourceRevision(family, options = {}) {
  const { mainPersonId } = validateFamilyData(family, options);
  const people = family
    .map((person) => ({
      id: person.id,
      parents: [...person.rels.parents].sort(compareStrings),
      children: [...person.rels.children].sort(compareStrings),
      spouses: [...person.rels.spouses].sort(compareStrings)
    }))
    .sort((left, right) => compareStrings(left.id, right.id));

  return digestRevision("canonical-source-v1", {
    schemaVersion: 1,
    mainPersonId,
    people
  });
}

export function computeAnchorCatalogVersion(anchors) {
  return digestRevision("public-anchor-catalog-v1", {
    schemaVersion: 1,
    anchors
  });
}

export function stableStringify(value) {
  return JSON.stringify(sortJsonValue(value));
}

export function compareStrings(left, right) {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validatePersonShape(person, personId, issues) {
  for (const key of Object.keys(person)) {
    if (key.startsWith("_") || INTERNAL_PERSON_KEYS.has(key)) {
      issues.push(`Person "${personId}" contains renderer-internal field "${key}".`);
    }
  }

  if (!isPlainObject(person.data)) {
    issues.push(`Person "${personId}" must have a data object.`);
  } else {
    for (const field of SUPPORTED_STRING_FIELDS) {
      if (field in person.data && typeof person.data[field] !== "string") {
        issues.push(`Person "${personId}" field data["${field}"] must be a string.`);
      }
    }

    if (!("gender" in person.data)) {
      issues.push(`Person "${personId}" must define data.gender as "M" or "F".`);
    } else if (typeof person.data.gender !== "string" || !SUPPORTED_GENDERS.has(person.data.gender)) {
      issues.push(`Person "${personId}" has unsupported gender ${JSON.stringify(person.data.gender)}; expected "M" or "F".`);
    }
  }

  if (!isPlainObject(person.rels)) {
    issues.push(`Person "${personId}" must have a rels object.`);
  } else {
    for (const key of Object.keys(person.rels)) {
      if (!RELATION_KEYS.includes(key)) {
        issues.push(`Person "${personId}" has unsupported relationship collection rels.${key}.`);
      }
    }

    for (const relation of RELATION_KEYS) {
      const endpoints = person.rels[relation];
      if (!Array.isArray(endpoints)) {
        issues.push(`Person "${personId}" rels.${relation} must be an array (use [] when empty).`);
        continue;
      }

      const seen = new Set();
      endpoints.forEach((endpoint, index) => {
        if (typeof endpoint !== "string" || !endpoint.trim()) {
          issues.push(`Person "${personId}" rels.${relation}[${index}] must be a non-empty string id.`);
          return;
        }
        if (endpoint !== endpoint.trim()) {
          issues.push(`Person "${personId}" rels.${relation}[${index}] has leading or trailing whitespace.`);
        }
        if (seen.has(endpoint)) {
          issues.push(`Person "${personId}" rels.${relation} contains duplicate id "${endpoint}".`);
        }
        seen.add(endpoint);
        if (endpoint === person.id) {
          issues.push(`Person "${personId}" may not reference itself in rels.${relation}.`);
        }
      });
    }

    if (Array.isArray(person.rels.parents) && person.rels.parents.length > 2) {
      issues.push(`Person "${personId}" has ${person.rels.parents.length} parents; the current renderer supports at most 2.`);
    }
  }

  validatePrivacy(person.privacy, personId, issues);
}

function validatePrivacy(privacy, personId, issues) {
  if (privacy === undefined) {
    return;
  }
  if (!isPlainObject(privacy)) {
    issues.push(`Person "${personId}" privacy must be an object when provided.`);
    return;
  }

  for (const key of Object.keys(privacy)) {
    if (!PRIVACY_KEYS.has(key)) {
      issues.push(`Person "${personId}" privacy contains unsupported field "${key}".`);
    }
  }

  if ("publicAnchor" in privacy && typeof privacy.publicAnchor !== "boolean") {
    issues.push(`Person "${personId}" privacy.publicAnchor must be a boolean.`);
  }

  for (const key of ["publicLabel", "publicLifespan", "publicBranchLabel"]) {
    if (key in privacy && typeof privacy[key] !== "string") {
      issues.push(`Person "${personId}" privacy.${key} must be a string.`);
    }
  }

  if (privacy.publicAnchor === true) {
    if (typeof privacy.publicLabel !== "string" || !privacy.publicLabel.trim()) {
      issues.push(`Person "${personId}" is a public anchor but privacy.publicLabel is missing or empty.`);
    }
  }
}

function validateRelationshipEndpoints(personId, person, peopleById, issues) {
  if (!isPlainObject(person.rels)) return;

  for (const relation of RELATION_KEYS) {
    const endpoints = person.rels[relation];
    if (!Array.isArray(endpoints)) continue;
    for (const endpoint of endpoints) {
      if (typeof endpoint === "string" && endpoint.trim() && !peopleById.has(endpoint)) {
        issues.push(`Person "${personId}" rels.${relation} references missing person "${endpoint}".`);
      }
    }
  }
}

function validateReciprocalRelationships(personId, person, peopleById, issues) {
  if (!isPlainObject(person.rels)) return;

  if (Array.isArray(person.rels.parents)) {
    for (const parentId of person.rels.parents) {
      const parent = peopleById.get(parentId);
      if (parent && Array.isArray(parent.rels?.children) && !parent.rels.children.includes(personId)) {
        issues.push(`Parent/child mismatch: "${personId}" lists parent "${parentId}", but "${parentId}" does not list "${personId}" as a child.`);
      }
    }
  }

  if (Array.isArray(person.rels.children)) {
    for (const childId of person.rels.children) {
      const child = peopleById.get(childId);
      if (child && Array.isArray(child.rels?.parents) && !child.rels.parents.includes(personId)) {
        issues.push(`Parent/child mismatch: "${personId}" lists child "${childId}", but "${childId}" does not list "${personId}" as a parent.`);
      }
    }
  }

  if (Array.isArray(person.rels.spouses)) {
    for (const spouseId of person.rels.spouses) {
      const spouse = peopleById.get(spouseId);
      if (spouse && Array.isArray(spouse.rels?.spouses) && !spouse.rels.spouses.includes(personId)) {
        issues.push(`Spouse mismatch: "${personId}" lists spouse "${spouseId}", but the relationship is not reciprocal.`);
      }
    }
  }
}

function validateAncestryCycles(peopleById, issues) {
  const childrenByParent = new Map([...peopleById.keys()].map((id) => [id, []]));
  for (const [childId, child] of peopleById) {
    if (!Array.isArray(child.rels?.parents)) continue;
    for (const parentId of child.rels.parents) {
      if (childrenByParent.has(parentId) && parentId !== childId) {
        childrenByParent.get(parentId).push(childId);
      }
    }
  }

  const state = new Map();
  const stack = [];
  let reported = false;

  function visit(id) {
    if (reported) return;
    const currentState = state.get(id) ?? 0;
    if (currentState === 2) return;
    if (currentState === 1) {
      const cycleStart = stack.indexOf(id);
      const cycle = [...stack.slice(cycleStart), id];
      issues.push(`Ancestry cycle detected: ${cycle.map((value) => `"${value}"`).join(" -> ")}.`);
      reported = true;
      return;
    }

    state.set(id, 1);
    stack.push(id);
    for (const childId of childrenByParent.get(id) ?? []) {
      visit(childId);
    }
    stack.pop();
    state.set(id, 2);
  }

  for (const id of peopleById.keys()) {
    visit(id);
    if (reported) break;
  }
}

function digestRevision(domain, value) {
  const digest = createHash("sha256")
    .update(`html-family-tree:${domain}\n`, "utf8")
    .update(stableStringify(value), "utf8")
    .digest("hex");
  return `sha256:${digest}`;
}

function sortJsonValue(value) {
  if (Array.isArray(value)) {
    return value.map(sortJsonValue);
  }
  if (isPlainObject(value)) {
    return Object.fromEntries(
      Object.keys(value)
        .sort(compareStrings)
        .map((key) => [key, sortJsonValue(value[key])])
    );
  }
  return value;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  const inputPath = path.resolve(options.input ?? "data/family.private.json");

  try {
    const family = JSON.parse(await readFile(inputPath, "utf8"));
    const result = validateFamilyData(family, {
      mainPersonId: options["main-person-id"]
    });
    const revision = computeCanonicalSourceRevision(family, {
      mainPersonId: options["main-person-id"]
    });
    console.log(`Validated ${result.personCount} canonical people. Main person: ${result.mainPersonId}.`);
    console.log(`Source revision: ${revision}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) continue;
    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = value;
      index += 1;
    }
  }
  return parsed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCli();
}
