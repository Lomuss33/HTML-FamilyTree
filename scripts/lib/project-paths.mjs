import path from "node:path";
import { fileURLToPath } from "node:url";
import { lstat, realpath, readFile } from "node:fs/promises";

export const REPOSITORY_ROOT = fileURLToPath(new URL("../../", import.meta.url));

export class FamilyWorkflowError extends Error {
  constructor(code, message, status = 400, details = {}) {
    super(message);
    this.name = "FamilyWorkflowError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

// JSON parser and validator errors can contain private values. Keep diagnostic
// details in memory; only fixed workflow messages and counts belong in logs.
export function safeErrorMessage(error, fallback = "The local operation failed. Inspect the input and recovery copies.") {
  if (error instanceof FamilyWorkflowError) return error.message;
  if (error?.name === "FamilyDataValidationError" && Array.isArray(error.issues)) {
    return "Canonical family data is invalid (" + error.issues.length + " issues). Private diagnostic values were omitted.";
  }
  return fallback;
}

export function projectPaths(root = REPOSITORY_ROOT) {
  root = path.resolve(root);
  return {
    root,
    privateDir: path.join(root, "private"),
    canonical: path.join(root, "private/family.json"),
    legacy: path.join(root, "data/family.private.json"),
    template: path.join(root, "data/family.template.json"),
    backups: path.join(root, "private/backups"),
    transactions: path.join(root, "private/transactions"),
    lock: path.join(root, "private/writer.lock"),
    encrypted: path.join(root, "data/family.enc.json"),
    catalog: path.join(root, "data/family.anchors.public.json"),
    allowlist: path.join(root, "api/generated/public-anchor-allowlist.json"),
    revision: path.join(root, "api/generated/canonical-revision.json"),
    dist: path.join(root, "dist")
  };
}

export function assertContained(root, target, { allowRoot = false } = {}) {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  if ((!relative && !allowRoot) || relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) {
    throw new FamilyWorkflowError("UNSAFE_PATH", "The requested path is outside the intended workspace.");
  }
  return path.resolve(target);
}

export async function assertSafePath(root, target) {
  const resolved = assertContained(root, target);
  const base = await realpath(root);
  let cursor = path.resolve(root);
  for (const part of path.relative(root, resolved).split(path.sep)) {
    cursor = path.join(cursor, part);
    try {
      const entry = await lstat(cursor);
      if (entry.isSymbolicLink()) throw new FamilyWorkflowError("UNSAFE_PATH", "Symbolic links and junctions are not allowed here.");
      assertContained(base, await realpath(cursor));
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      break;
    }
  }
  return resolved;
}

export async function fileExists(file) {
  try { await lstat(file); return true; } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

export async function canonicalPath(paths, { required = true } = {}) {
  const modern = await fileExists(paths.canonical);
  const legacy = await fileExists(paths.legacy);
  if (modern && legacy) throw new FamilyWorkflowError("SOURCE_CONFLICT", "Both canonical sources exist. Reconcile them before writing.", 409);
  const file = modern ? paths.canonical : legacy ? paths.legacy : null;
  if (!file && required) throw new FamilyWorkflowError("SOURCE_MISSING", "No private family source exists. Follow the setup or migration instructions.");
  if (file) await assertSafePath(paths.root, file);
  return file;
}

export async function readJson(file) {
  try { return JSON.parse(await readFile(file, "utf8")); }
  catch (error) {
    if (error.code === "ENOENT") throw error;
    throw new FamilyWorkflowError("INVALID_JSON", "A required JSON file could not be read.");
  }
}

export function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    if (!args[i].startsWith("--")) throw new FamilyWorkflowError("INVALID_ARGUMENT", "Expected a named --option.");
    const name = args[i].slice(2);
    options[name] = args[i + 1] && !args[i + 1].startsWith("--") ? args[++i] : true;
  }
  return options;
}
