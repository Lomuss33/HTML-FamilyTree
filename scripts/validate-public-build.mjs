import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import { projectPaths, canonicalPath, parseArgs, FamilyWorkflowError, safeErrorMessage } from "./lib/project-paths.mjs";
import { decryptFamily, validateEncryptedPayload } from "./lib/family-crypto.mjs";
import path from "node:path";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { buildPublicAnchorArtifacts } from "./generate-public-anchors.mjs";
import { validateGeneratedArtifacts } from "./lib/public-artifacts.mjs";
export { validateGeneratedArtifacts } from "./lib/public-artifacts.mjs";
import {
  stableStringify,
  validateFamilyData
} from "./validate-family-data.mjs";

const execFileAsync = promisify(execFile);
export function validatePublicRuntimeConfig(source) {
  const forbiddenProperty = /\b(?:accessCode|familyPassword|password|secret|submissionAccessCode|token)\s*:/i;
  if (forbiddenProperty.test(source)) {
    throw new Error("assets/site-config.js contains a forbidden secret-bearing configuration property.");
  }
}

export async function validateProject({ root, requirePassword = false, password = process.env.FAMILY_TREE_PASSWORD, outputDirectory } = {}) {
  const paths = projectPaths(root);
  await assertPrivateFilesNotTracked(paths);
  const catalog = await readJson(outputDirectory ? path.join(outputDirectory, "data/family.anchors.public.json") : paths.catalog, "public catalog");
  const allowlist = await readJson(paths.allowlist, "backend allowlist");
  const revision = await readJson(paths.revision, "backend revision");
  const summary = validateGeneratedArtifacts(catalog, allowlist, revision);
  const configFile = outputDirectory ? path.join(outputDirectory, "assets/site-config.js") : path.join(paths.root, "assets/site-config.js");
  const configSource = await readFile(configFile, "utf8");
  validatePublicRuntimeConfig(configSource);
  const sandbox = { window: {} };
  runInNewContext(configSource, sandbox, { timeout: 1000 });
  const { PUBLIC_FILES, validateRuntimeConfig, validateSiteDirectory } = await import("./lib/publication.mjs");
  validateRuntimeConfig(sandbox.window.FAMILY_TREE_CONFIG);
  if (outputDirectory) await validateSiteDirectory(paths, outputDirectory, sandbox.window.FAMILY_TREE_CONFIG);
  const encryptedFile = outputDirectory ? path.join(outputDirectory, "data/family.enc.json") : paths.encrypted;
  validateEncryptedPayload(await readJson(encryptedFile, "encrypted payload"));
  const source = await canonicalPath(paths, { required: false });
  if (!source) {
    if (requirePassword) throw new FamilyWorkflowError("SOURCE_MISSING", "Publish readiness requires the private source and a locally supplied password.");
    validateFamilyData(await readJson(paths.template, "fictional template"));
    return { ...summary, privateSourcePresent: false, freshness: "not-checked-private-source-absent", decryption: "not-checked-private-source-absent" };
  }
  const nodes = await readJson(source, "canonical source");
  validateFamilyData(nodes);
  const expected = buildPublicAnchorArtifacts(nodes);
  for (const key of ["catalog", "allowlist", "revision"]) {
    if (stableStringify(expected[key]) !== stableStringify({ catalog, allowlist, revision }[key])) {
      throw new FamilyWorkflowError("STALE_ARTIFACTS", "Prepared public/backend artifacts differ from the private source. Run the preparation workflow.", 409);
    }
  }
  const tokens = new Set();
  const fullNames = new Set();
  for (const node of nodes) {
    const first = node.data?.["first name"]?.trim();
    const last = node.data?.["last name"]?.trim();
    if (first && last) fullNames.add(first + " " + last);
    for (const value of [first, last]) if (value && value.length >= 3) tokens.add(value);
  }
  const base = outputDirectory ?? paths.root;
  for (const relative of PUBLIC_FILES.filter(file => !file.startsWith("data/") && !file.startsWith("assets/vendor/"))) {
    const content = await readFile(path.join(base, relative), "utf8");
    // Short surnames can also be code identifiers or generic UI words. Match full
    // names or complete string/text values, rather than substrings of identifiers.
    const leaked = [...fullNames].some(name => content.includes(name))
      || [...tokens].some(token => content.includes(JSON.stringify(token))
        || content.includes("'" + token.replaceAll("\\", "\\\\").replaceAll("'", "\\'") + "'")
        || content.includes(">" + token + "<"));
    if (leaked) throw new FamilyWorkflowError("PRIVATE_VALUE_IN_PUBLIC_OUTPUT", "A private-name value was found in a public asset: " + relative);
  }
  let decryption = "not-checked-password-required";
  if (password) {
    const decrypted = await decryptFamily(await readJson(encryptedFile, "encrypted payload"), password);
    if (stableStringify(decrypted) !== stableStringify(nodes)) throw new FamilyWorkflowError("ENCRYPTED_SOURCE_STALE", "The encrypted publication needs regeneration from the current private source.", 409);
    decryption = "verified";
  } else if (requirePassword) throw new FamilyWorkflowError("PASSWORD_REQUIRED", "Supply the family password locally to verify publish readiness.");
  return { ...summary, privateSourcePresent: true, freshness: "verified", decryption };
}

export async function assertPrivateFilesNotTracked(paths) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync("git", ["ls-files", "--cached", "-z"], { cwd: paths.root, encoding: "utf8" }));
  } catch (error) {
    if (String(error.stderr ?? "").includes("not a git repository")) return;
    throw error;
  }
  for (const file of stdout.split("\0").filter(Boolean)) {
    const normalized = file.replaceAll("\\", "/");
    if (/^(?:private\/|data\/family\.private\.json$|data\/backups\/)/i.test(normalized)
      || /^family-private-draft.*\.json$/i.test(path.posix.basename(normalized))) {
      throw new FamilyWorkflowError("PRIVATE_FILE_TRACKED", "A private source or recovery file is tracked by Git.");
    }
  }
}

async function readJson(filePath, label) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    throw new FamilyWorkflowError("INVALID_JSON", "Unable to read valid " + label + ". Check the file locally.");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    console.log(JSON.stringify(await validateProject({ root: options.root, requirePassword: options["require-password"] === true, outputDirectory: options.dist ? path.resolve(options.dist) : undefined }), null, 2));
  } catch (error) {
    console.error(safeErrorMessage(error, "Public validation stopped. Check the approved artifacts locally."));
    process.exitCode = 1;
  }
}
