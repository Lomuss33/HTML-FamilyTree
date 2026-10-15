import { createFamilyWorkflow } from "./lib/family-workflow.mjs";
import { digest } from "./lib/family-crypto.mjs";
import { projectPaths, parseArgs, FamilyWorkflowError, safeErrorMessage } from "./lib/project-paths.mjs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
  compareStrings,
  computeCanonicalSourceRevision,
  validateFamilyData
} from "./validate-family-data.mjs";

const REVISION_PATTERN = /^sha256:[a-f0-9]{64}$/;
const NEW_ID_PATTERN = /^sg_[0-9a-f]{32}_[1-9][0-9]{0,3}$/;
const TOP_LEVEL_KEYS = new Set([
  "schemaVersion",
  "type",
  "suggestionId",
  "anchorPersonId",
  "anchorCatalogVersion",
  "sourceRevision",
  "addPeople",
  "addRelationships"
]);

export function applyFamilyAdditions(family, patch, { catalogVersion } = {}) {
  validateFamilyData(family);
  validatePatchShape(patch);
  if (catalogVersion !== undefined && patch.anchorCatalogVersion !== catalogVersion) {
    throw new Error("Patch anchor catalog version does not match the current public catalog.");
  }
  if (patch.sourceRevision !== computeCanonicalSourceRevision(family)) {
    throw new Error("Patch source revision does not match the current canonical family.");
  }

  const existingIds = new Set(family.map((person) => person.id));
  if (!existingIds.has(patch.anchorPersonId)) throw new Error("Patch anchor does not exist in the canonical family.");
  const newIds = new Set();
  for (const person of patch.addPeople) {
    if (existingIds.has(person.id) || newIds.has(person.id)) throw new Error(`Patch person id "${person.id}" is not unique.`);
    newIds.add(person.id);
  }

  validatePatchRelationships(patch, newIds);
  const result = structuredClone(family);
  result.push(...structuredClone(patch.addPeople));
  const byId = new Map(result.map((person) => [person.id, person]));
  for (const relationship of patch.addRelationships) {
    const from = byId.get(relationship.from);
    const to = byId.get(relationship.to);
    if (relationship.type === "parentOf") {
      from.rels.children.push(to.id);
      to.rels.parents.push(from.id);
    } else {
      from.rels.spouses.push(to.id);
      to.rels.spouses.push(from.id);
    }
  }
  validateFamilyData(result);
  return result;
}

function validatePatchShape(patch) {
  if (!isPlainObject(patch)) throw new Error("Patch must be an object.");
  requireExactKeys(patch, TOP_LEVEL_KEYS, "Patch");
  if (patch.schemaVersion !== 1 || patch.type !== "family-additions") throw new Error("Unsupported patch schema.");
  if (typeof patch.suggestionId !== "string" || !patch.suggestionId) throw new Error("Patch suggestionId is required.");
  if (typeof patch.anchorPersonId !== "string" || !patch.anchorPersonId || /^tmp_/i.test(patch.anchorPersonId)) {
    throw new Error("Patch anchorPersonId is invalid.");
  }
  for (const key of ["anchorCatalogVersion", "sourceRevision"]) {
    if (!REVISION_PATTERN.test(patch[key] ?? "")) throw new Error(`Patch ${key} is invalid.`);
  }
  if (!Array.isArray(patch.addPeople) || patch.addPeople.length < 1 || patch.addPeople.length > 50) {
    throw new Error("Patch addPeople must contain 1 to 50 people.");
  }
  if (!Array.isArray(patch.addRelationships) || patch.addRelationships.length < 1 || patch.addRelationships.length > 100) {
    throw new Error("Patch addRelationships must contain 1 to 100 relationships.");
  }

  for (const person of patch.addPeople) validatePatchPerson(person);
}

function validatePatchPerson(person) {
  requireExactKeys(person, new Set(["id", "data", "rels"]), "Patch person");
  if (!NEW_ID_PATTERN.test(person.id ?? "")) throw new Error("Patch person id is not a generated suggestion id.");
  requireExactKeys(person.data, new Set(["first name", "last name", "birthday", "gender"]), `Patch person "${person.id}" data`);
  for (const field of ["first name", "last name", "birthday"]) {
    if (typeof person.data[field] !== "string") throw new Error(`Patch person "${person.id}" ${field} must be a string.`);
  }
  if (!new Set(["M", "F"]).has(person.data.gender)) throw new Error(`Patch person "${person.id}" gender is invalid.`);
  requireExactKeys(person.rels, new Set(["parents", "children", "spouses"]), `Patch person "${person.id}" rels`);
  for (const relation of ["parents", "children", "spouses"]) {
    if (!Array.isArray(person.rels[relation]) || person.rels[relation].length !== 0) {
      throw new Error(`Patch person "${person.id}" rels.${relation} must start empty.`);
    }
  }
}

function validatePatchRelationships(patch, newIds) {
  const allowedEndpoints = new Set([patch.anchorPersonId, ...newIds]);
  const seen = new Set();
  const adjacency = new Map([...allowedEndpoints].map((id) => [id, []]));
  for (const relationship of patch.addRelationships) {
    requireExactKeys(relationship, new Set(["from", "to", "type"]), "Patch relationship");
    if (!new Set(["parentOf", "spouseOf"]).has(relationship.type)) throw new Error("Patch relationship type is invalid.");
    if (!allowedEndpoints.has(relationship.from) || !allowedEndpoints.has(relationship.to)) {
      throw new Error("Patch relationship has a dangling or unauthorized endpoint.");
    }
    if (relationship.from === relationship.to) throw new Error("Patch relationship cannot reference one person twice.");
    if (!newIds.has(relationship.from) && !newIds.has(relationship.to)) {
      throw new Error("Patch cannot add a canonical-to-canonical relationship.");
    }
    const endpoints = relationship.type === "spouseOf"
      ? [relationship.from, relationship.to].sort(compareStrings)
      : [relationship.from, relationship.to];
    const key = `${relationship.type}\u0000${endpoints[0]}\u0000${endpoints[1]}`;
    if (seen.has(key)) throw new Error("Patch contains a duplicate relationship.");
    seen.add(key);
    adjacency.get(relationship.from).push(relationship.to);
    adjacency.get(relationship.to).push(relationship.from);
  }
  const connected = new Set([patch.anchorPersonId]);
  const queue = [patch.anchorPersonId];
  while (queue.length) {
    const current = queue.shift();
    for (const next of adjacency.get(current) ?? []) {
      if (!connected.has(next)) {
        connected.add(next);
        queue.push(next);
      }
    }
  }
  if ([...newIds].some((id) => !connected.has(id))) throw new Error("Every patch person must remain connected to the canonical anchor.");
}

async function runCli() {
  const options = parseArgs(process.argv.slice(2));
  if (typeof options.patch !== "string") throw new FamilyWorkflowError("PATCH_REQUIRED", "Use --patch <reviewed-additions.json>.");
  const paths = projectPaths(options.root);
  const workflow = createFamilyWorkflow(paths);
  const snapshot = await workflow.snapshot();
  const patch = JSON.parse(await readFile(path.resolve(options.patch), "utf8"));
  validatePatchShape(patch);
  const inputDigest = digest(JSON.stringify(patch));
  const operationId = "patch-" + patch.suggestionId.replaceAll("-", "");
  const prior = await workflow.receipt(operationId);
  if (prior?.state === "committed") {
    if (prior.result.inputDigest !== inputDigest) throw new FamilyWorkflowError("OPERATION_CONFLICT", "A different patch already used this suggestion identifier.", 409);
    console.log(JSON.stringify({ ...prior.result, alreadyApplied: true }, null, 2));
    return;
  }
  const catalog = JSON.parse(await readFile(paths.catalog, "utf8"));
  const nodes = applyFamilyAdditions(snapshot.nodes, patch, { catalogVersion: catalog.catalogVersion });
  if (options["dry-run"]) { console.log(JSON.stringify({ dryRun: true, addedPeople: patch.addPeople.length, addedRelationships: patch.addRelationships.length })); return; }
  if (!process.env.FAMILY_TREE_PASSWORD) throw new FamilyWorkflowError("PASSWORD_REQUIRED", "Supply FAMILY_TREE_PASSWORD locally.");
  const result = await workflow.save({ nodes, password: process.env.FAMILY_TREE_PASSWORD, operation: "patch",
    operationId, inputDigest, expectedRevision: snapshot.privateRevision, snapshotId: snapshot.snapshotId });
  if (!result.ok) throw new FamilyWorkflowError("PUBLICATION_REVIEW", "Patch publication requires explicit review.", 409);
  console.log(JSON.stringify(result, null, 2));
}

function requireExactKeys(value, keys, label) {
  if (!isPlainObject(value)) throw new Error(`${label} must be an object.`);
  const actual = Object.keys(value).sort(compareStrings);
  const expected = [...keys].sort(compareStrings);
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} contains unsupported or missing fields.`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    await runCli();
  } catch (error) {
    console.error(safeErrorMessage(error, "Patch application stopped. Check the reviewed patch locally."));
    process.exitCode = 1;
  }
}
