import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { validateFamilyData } from "./validate-family-data.mjs";

const PRIVATE_SOURCE_PATH = path.resolve("data/family.private.json");
const execFileAsync = promisify(execFile);

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

export async function migrateAllPublicAnchorsFile(filePath = PRIVATE_SOURCE_PATH) {
  const resolvedPath = path.resolve(filePath);
  if (resolvedPath === PRIVATE_SOURCE_PATH) await assertPrivateSourceIsIgnored();
  const originalText = await readFile(resolvedPath, "utf8");
  const family = JSON.parse(originalText);
  const migrated = enableAllPublicAnchors(family);
  const output = `${JSON.stringify(migrated, null, 2)}\n`;
  const temporaryPath = path.join(
    path.dirname(resolvedPath),
    `.${path.basename(resolvedPath)}.${randomUUID()}.tmp`
  );

  try {
    await writeFile(temporaryPath, output, { encoding: "utf8", flag: "wx" });
    const verified = JSON.parse(await readFile(temporaryPath, "utf8"));
    validateFamilyData(verified);
    verifyMigrationPreservedCanonicalGraph(family, verified);
    await rename(temporaryPath, resolvedPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }

  return {
    personCount: migrated.length,
    optedInCount: migrated.filter((person) => person.privacy?.publicAnchor === true).length,
    filePath: resolvedPath
  };
}

async function assertPrivateSourceIsIgnored() {
  const { stdout: tracked } = await execFileAsync(
    "git",
    ["ls-files", "--", "data/family.private.json"],
    { encoding: "utf8" }
  );
  if (tracked.trim()) {
    throw new Error("Refusing migration: data/family.private.json is tracked by Git.");
  }

  try {
    await execFileAsync(
      "git",
      ["check-ignore", "--quiet", "data/family.private.json"],
      { encoding: "utf8" }
    );
  } catch {
    throw new Error("Refusing migration: data/family.private.json is not covered by .gitignore.");
  }
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
    const result = await migrateAllPublicAnchorsFile(PRIVATE_SOURCE_PATH);
    console.log(`Opted in ${result.optedInCount} of ${result.personCount} canonical people.`);
    console.log(`Updated ignored private source: ${result.filePath}`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runCli();
}
