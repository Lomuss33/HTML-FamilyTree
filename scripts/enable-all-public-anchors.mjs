import path from "node:path";
import { pathToFileURL } from "node:url";
import { validateFamilyData } from "./validate-family-data.mjs";
import { safeErrorMessage } from "./lib/project-paths.mjs";

export function enableAllPublicAnchors(family) {
  validateFamilyData(family);
  const migrated = structuredClone(family);

  for (const person of migrated) {
    const publicLabel = derivePublicLabel(person);
    const existingPrivacy = isPlainObject(person.privacy) ? person.privacy : {};
    const existingLifespan = cleanString(existingPrivacy.publicLifespan);
    const displayedBirthday = cleanString(person.data?.birthday);
    const existingBranchLabel = cleanString(existingPrivacy.publicBranchLabel);

    person.privacy = {
      publicAnchor: true,
      publicLabel,
      publicLifespan: existingLifespan || displayedBirthday,
      publicBranchLabel: existingBranchLabel
    };
  }

  validateFamilyData(migrated);
  verifyMigrationPreservedCanonicalGraph(family, migrated);
  return migrated;
}

function derivePublicLabel(person) {
  const firstName = cleanString(person.data?.["first name"]);
  const lastName = cleanString(person.data?.["last name"]);
  const label = [firstName, lastName].filter(Boolean).join(" ");
  if (!label) {
    throw new Error(`Cannot publish canonical person "${person.id}": first name and last name are both empty.`);
  }
  return label;
}

function verifyMigrationPreservedCanonicalGraph(before, after) {
  if (before.length !== after.length) {
    throw new Error("Public-anchor migration changed the canonical person count.");
  }

  before.forEach((person, index) => {
    const migrated = after[index];
    if (person.id !== migrated.id) {
      throw new Error(`Public-anchor migration changed canonical id at index ${index}.`);
    }
    if (JSON.stringify(person.data) !== JSON.stringify(migrated.data)) {
      throw new Error(`Public-anchor migration changed canonical data for "${person.id}".`);
    }
    if (JSON.stringify(person.rels) !== JSON.stringify(migrated.rels)) {
      throw new Error(`Public-anchor migration changed canonical relationships for "${person.id}".`);
    }
    const unrelatedBefore = omitPrivacy(person);
    const unrelatedAfter = omitPrivacy(migrated);
    if (JSON.stringify(unrelatedBefore) !== JSON.stringify(unrelatedAfter)) {
      throw new Error(`Public-anchor migration changed unrelated fields for "${person.id}".`);
    }
  });
}

function omitPrivacy(person) {
  const copy = structuredClone(person);
  delete copy.privacy;
  return copy;
}

function cleanString(value) {
  return typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

async function runCli() {
  try {
    const { runPreparation } = await import("./prepare-family.mjs");
    await runPreparation(process.argv.slice(2), { transform: enableAllPublicAnchors });
  } catch (error) {
    console.error(error.code ?? "ANCHOR_PREPARATION_FAILED", safeErrorMessage(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  void runCli();
}
