import { mkdir, readFile, writeFile, readdir, rename, rm, lstat } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { assertContained, assertSafePath, FamilyWorkflowError, fileExists, readJson, canonicalPath } from "./project-paths.mjs";
import { buildPublicAnchorArtifacts } from "../generate-public-anchors.mjs";
import { stableStringify } from "../validate-family-data.mjs";
import { digest, validateEncryptedPayload } from "./family-crypto.mjs";
import { publicBytes } from "./public-bytes.mjs";
import { validateGeneratedArtifacts } from "./public-artifacts.mjs";
import { inspectTransactions, withWriterLock } from "./file-transaction.mjs";

export const PUBLIC_FILES = Object.freeze([
  "index.html", "assets/app.js", "assets/app.css", "assets/favicon.svg",
  "assets/vendor/d3.min.js", "assets/vendor/family-chart.js", "assets/vendor/family-chart.css",
  "assets/suggestions/visual-editor.js", "assets/suggestions/draft-model.js",
  "assets/suggestions/graph-adapter.js", "assets/suggestions/public-anchor-catalog.js",
  "assets/suggestions/submission-api.js", "assets/admin/review-workspace.js",
  "assets/admin/review-graph-adapter.js", "assets/admin/patch-model.js",
  "assets/admin/auth-client.js", "assets/admin/api-client.js",
  "assets/editor/local-api.js", "assets/editor/card-draft.js", "assets/viewer/editor-state.js", "assets/viewer/card-format.js",
  "data/family.enc.json", "data/family.anchors.public.json"
]);
export const PUBLIC_OUTPUT_FILES = Object.freeze([...PUBLIC_FILES, "assets/site-config.js", ".nojekyll"]);

export function validateRuntimeConfig(value, { environment = "local" } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new FamilyWorkflowError("INVALID_CONFIG", "Runtime configuration must be an object.");
  if (Object.keys(value).some(key => !["suggestionsApiUrl", "adminApiUrl", "adminAuth"].includes(key))) throw new FamilyWorkflowError("INVALID_CONFIG", "Runtime config contains an unsupported or secret-bearing property.");
  const result = { suggestionsApiUrl: value.suggestionsApiUrl ?? "", adminApiUrl: value.adminApiUrl ?? "", adminAuth: value.adminAuth ?? null };
  function endpoint(input, label) {
    if (typeof input !== "string") throw new FamilyWorkflowError("INVALID_CONFIG", "Invalid " + label + ".");
    if (!input) return "";
    let url;
    try { url = new URL(input); } catch { throw new FamilyWorkflowError("INVALID_CONFIG", "Invalid " + label + "."); }
    const local = environment !== "production" && url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !local) || url.username || url.password || url.hash) throw new FamilyWorkflowError("INVALID_CONFIG", "Unsafe " + label + ".");
    return input;
  }
  result.suggestionsApiUrl = endpoint(result.suggestionsApiUrl, "suggestion endpoint");
  result.adminApiUrl = endpoint(result.adminApiUrl, "review endpoint");
  if (result.adminAuth !== null) {
    const auth = result.adminAuth;
    if (!auth || typeof auth !== "object" || Array.isArray(auth)
      || Object.keys(auth).sort().join() !== "clientId,domain,logoutUri,redirectUri"
      || typeof auth.clientId !== "string" || !/^[a-zA-Z0-9_-]{1,200}$/.test(auth.clientId)) {
      throw new FamilyWorkflowError("INVALID_CONFIG", "Invalid administrator sign-in configuration.");
    }
    result.adminAuth = { clientId: auth.clientId, domain: endpoint(auth.domain, "sign-in domain"),
      redirectUri: endpoint(auth.redirectUri, "callback URL"), logoutUri: endpoint(auth.logoutUri, "logout URL") };
    if (!result.adminAuth.domain || !result.adminAuth.redirectUri || !result.adminAuth.logoutUri
      || new URL(result.adminAuth.redirectUri).origin !== new URL(result.adminAuth.logoutUri).origin) {
      throw new FamilyWorkflowError("INVALID_CONFIG", "The sign-in return URLs must have the same intended origin.");
    }
  }
  if (Boolean(result.adminApiUrl) !== Boolean(result.adminAuth)) throw new FamilyWorkflowError("INVALID_CONFIG", "Administrator API and sign-in configuration must be enabled together.");
  return result;
}

export async function loadRuntimeConfig(paths, environment = "local", override) {
  if (!["local", "test", "production"].includes(environment)) throw new FamilyWorkflowError("INVALID_CONFIG", "Unknown configuration environment.");
  const file = path.join(paths.root, environment === "production" ? "config/production.json" : "config/local.json");
  let value = override;
  if (!value) value = await fileExists(file) ? await readJson(await assertSafePath(paths.root, file)) : {};
  return validateRuntimeConfig(value, { environment });
}

async function outputFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(path.join(directory, prefix), { withFileTypes: true })) {
    const relative = path.posix.join(prefix, entry.name);
    if (entry.isSymbolicLink()) throw new FamilyWorkflowError("UNSAFE_BUILD", "Public output contains a symbolic link.");
    if (entry.isDirectory()) files.push(...await outputFiles(directory, relative));
    else if (entry.isFile()) files.push(relative);
    else throw new FamilyWorkflowError("UNSAFE_BUILD", "Public output contains a nonregular file.");
  }
  return files;
}

export async function validateSiteDirectory(paths, directory, config) {
  assertContained(paths.root, directory);
  const actual = (await outputFiles(directory)).sort();
  if (actual.join("\n") !== [...PUBLIC_OUTPUT_FILES].sort().join("\n")) throw new FamilyWorkflowError("UNSAFE_BUILD", "Public output does not exactly match the approved file manifest.");
  for (const relative of actual) await assertSafePath(paths.root, path.join(directory, relative));
  const catalog = await readJson(path.join(directory, "data/family.anchors.public.json"));
  const summary = validateGeneratedArtifacts(catalog, await readJson(paths.allowlist), await readJson(paths.revision));
  validateEncryptedPayload(await readJson(path.join(directory, "data/family.enc.json")));
  validateRuntimeConfig(config);
  const allowed = new Set(actual);
  for (const relative of actual.filter(name => name.endsWith(".js") || name === "index.html")) {
    if (relative.startsWith("assets/vendor/")) continue;
    const source = await readFile(path.join(directory, relative), "utf8");
    const references = relative.endsWith(".js")
      ? [...source.matchAll(/(?:import|export)\s+(?:[\s\S]*?\sfrom\s*)?["'](\.[^"']+)["']/g)].map(match => match[1])
      : [...source.matchAll(/(?:src|href)=["'](\.[^"']+)["']/g)].map(match => match[1]);
    for (const reference of references) {
      const target = path.posix.normalize(path.posix.join(path.posix.dirname(relative), reference));
      if (!allowed.has(target)) throw new FamilyWorkflowError("BROKEN_BUILD", "A required public asset is absent: " + target);
    }
  }
  return summary;
}

export async function buildSite(paths, options = {}) {
  return withWriterLock(paths, () => buildUnlocked(paths, options));
}

async function buildUnlocked(paths, { environment = "local", runtimeConfig } = {}) {
  const pending = await inspectTransactions(paths);
  if (pending.some(({ journal }) => !["committed", "rolled-back", "aborted"].includes(journal.state))) throw new FamilyWorkflowError("RECOVERY_REQUIRED", "Recover the interrupted family operation before building.", 503);
  const config = await loadRuntimeConfig(paths, environment, runtimeConfig);
  const source = await canonicalPath(paths, { required: false });
  if (source) {
    const expected = buildPublicAnchorArtifacts(await readJson(source));
    for (const key of ["catalog", "allowlist", "revision"]) {
      if (stableStringify(expected[key]) !== stableStringify(await readJson(paths[key]))) {
        throw new FamilyWorkflowError("STALE_ARTIFACTS", "Prepare the public artifacts from the current source before building.", 409);
      }
    }
  }
  const directory = paths.dist + ".build-" + randomUUID();
  await assertSafePath(paths.root, directory);
  await mkdir(directory, { mode: 0o700 });
  let previous;
  try {
    for (const relative of PUBLIC_FILES) {
      const source = await assertSafePath(paths.root, path.join(paths.root, relative));
      if (!(await lstat(source)).isFile()) throw new FamilyWorkflowError("UNSAFE_BUILD", "A public source is not a regular file.");
      const target = path.join(directory, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, publicBytes(relative, await readFile(source)));
    }
    await writeFile(path.join(directory, "assets/site-config.js"), "window.FAMILY_TREE_CONFIG = Object.freeze(" + JSON.stringify(config) + ");\n");
    await writeFile(path.join(directory, ".nojekyll"), "");
    const summary = await validateSiteDirectory(paths, directory, config);
    const inventory = [];
    for (const relative of [...PUBLIC_OUTPUT_FILES].sort()) {
      const content = await readFile(path.join(directory, relative));
      inventory.push({ path: relative, bytes: content.length, digest: digest(content) });
    }
    await assertSafePath(paths.root, paths.dist);
    if (await fileExists(paths.dist)) {
      previous = paths.dist + ".previous-" + randomUUID();
      await rename(paths.dist, previous);
    }
    try { await rename(directory, paths.dist); }
    catch (error) { if (previous) await rename(previous, paths.dist); previous = null; throw error; }
    return { environment, ...summary, inventory, siteDigest: digest(JSON.stringify(inventory)) };
  } finally {
    for (const generated of [directory, previous].filter(Boolean)) {
      if (await fileExists(generated)) {
        await assertSafePath(paths.root, generated);
        await rm(generated, { recursive: true, force: true });
      }
    }
  }
}

export async function loadSiteBuffers(paths) {
  const buffers = new Map();
  for (const relative of PUBLIC_OUTPUT_FILES) {
    await assertSafePath(paths.root, path.join(paths.dist, relative));
    buffers.set("/" + relative, await readFile(path.join(paths.dist, relative)));
  }
  return buffers;
}
