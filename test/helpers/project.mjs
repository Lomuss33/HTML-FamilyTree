import { mkdtemp, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { projectPaths, REPOSITORY_ROOT, assertContained } from "../../scripts/lib/project-paths.mjs";
import { encryptFamily, jsonText, digest } from "../../scripts/lib/family-crypto.mjs";
import { buildPublicAnchorArtifacts } from "../../scripts/generate-public-anchors.mjs";
import { PUBLIC_FILES } from "../../scripts/lib/publication.mjs";

export const PASSWORD = "fictional-test-password-only";
export const fixture = async name => JSON.parse(await readFile(path.join(REPOSITORY_ROOT, "test/fixtures/family", name), "utf8"));

export async function createProject(t, { nodes, legacy = false, site = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "family-repair-"));
  const paths = projectPaths(root);
  if (t) t.after(async () => {
    assertContained(os.tmpdir(), root);
    if (!path.basename(root).startsWith("family-repair-")) throw new Error("Unsafe test cleanup.");
    await rm(root, { recursive: true, force: true });
  });
  nodes ??= await fixture("valid-public-anchor.json");
  for (const directory of ["data", "api/generated", ...(legacy ? [] : ["private"])]) await mkdir(path.join(root, directory), { recursive: true });
  const artifacts = buildPublicAnchorArtifacts(nodes);
  await writeFile(legacy ? paths.legacy : paths.canonical, jsonText(nodes));
  await writeFile(paths.encrypted, jsonText(await encryptFamily(nodes, PASSWORD, { iterations: 100000 })));
  await writeFile(paths.catalog, jsonText(artifacts.catalog));
  await writeFile(paths.allowlist, jsonText(artifacts.allowlist));
  await writeFile(paths.revision, jsonText(artifacts.revision));
  await writeFile(paths.template, await readFile(path.join(REPOSITORY_ROOT, "data/family.template.json")));
  if (site) {
    await mkdir(path.join(root, "assets"), { recursive: true });
    await writeFile(path.join(root, "assets/site-config.js"), await readFile(path.join(REPOSITORY_ROOT, "assets/site-config.js")));
    for (const relative of PUBLIC_FILES.filter(file => !file.startsWith("data/"))) {
      const target = path.join(root, relative);
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, await readFile(path.join(REPOSITORY_ROOT, relative)));
    }
  }
  return { paths, nodes: structuredClone(nodes), artifacts };
}

export async function hashes(paths) {
  const result = {};
  for (const key of ["canonical", "encrypted", "catalog", "allowlist", "revision"]) result[key] = digest(await readFile(paths[key]));
  return result;
}
