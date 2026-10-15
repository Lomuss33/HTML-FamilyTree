import assert from "node:assert/strict";
import test from "node:test";
import { readFile, writeFile, mkdir, unlink, symlink, rename } from "node:fs/promises";
import path from "node:path";
import { createProject, hashes } from "./helpers/project.mjs";
import { buildSite, PUBLIC_OUTPUT_FILES, validateSiteDirectory, validateRuntimeConfig } from "../scripts/lib/publication.mjs";
import { validateProject } from "../scripts/validate-public-build.mjs";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

test("build is deterministic, disables external services and never rewrites prepared family files", async t => {
  const { paths } = await createProject(t, { site: true });
  const before = await hashes(paths);
  const first = await buildSite(paths);
  const second = await buildSite(paths);
  assert.equal(first.siteDigest, second.siteDigest);
  assert.equal(first.inventory.length, PUBLIC_OUTPUT_FILES.length);
  assert.deepEqual(await hashes(paths), before);
  const config = await readFile(path.join(paths.dist, "assets/site-config.js"), "utf8");
  assert.equal(config.includes("execute-api"), false);
  assert.equal(config.includes('"suggestionsApiUrl":""'), true);
  await mkdir(path.join(paths.backups), { recursive: true });
  await writeFile(path.join(paths.backups, "fictional-private.json"), "private canary");
  await assert.doesNotReject(buildSite(paths));
  await writeFile(path.join(paths.dist, "private-copy.json"), "private canary");
  await assert.rejects(validateSiteDirectory(paths, paths.dist, {}), { code: "UNSAFE_BUILD" });
});

test("failed assembly keeps the active release and rejects secret or insecure production config", async t => {
  const { paths } = await createProject(t, { site: true });
  await buildSite(paths);
  const before = await readFile(path.join(paths.dist, "index.html"), "utf8");
  await unlink(path.join(paths.root, "assets/app.js"));
  await assert.rejects(buildSite(paths));
  assert.equal(await readFile(path.join(paths.dist, "index.html"), "utf8"), before);
  assert.throws(() => validateRuntimeConfig({ familyPassword: "fictional" }), { code: "INVALID_CONFIG" });
  assert.throws(() => validateRuntimeConfig({ suggestionsApiUrl: "http://public.example/" }, { environment: "production" }), { code: "INVALID_CONFIG" });
});

test("build rejects a linked source directory even when its target is inside the project", async t => {
  const { paths } = await createProject(t, { site: true });
  const target = path.join(paths.privateDir, "fixture-assets");
  const link = path.join(paths.root, "assets");
  await rename(link, target);
  await symlink(target, link, process.platform === "win32" ? "junction" : "dir");
  await assert.rejects(buildSite(paths), { code: "UNSAFE_PATH" });
});

test("leak scanning accepts generic identifiers but rejects a complete private-name value", async t => {
  const { paths } = await createProject(t, { site: true });
  await assert.doesNotReject(validateProject({ root: paths.root }));
  const file = path.join(paths.root, "assets/app.js");
  await writeFile(file, (await readFile(file, "utf8")) + '\nconst leaked = "PrivateOnlyFirst";\n');
  await assert.rejects(validateProject({ root: paths.root }), { code: "PRIVATE_VALUE_IN_PUBLIC_OUTPUT" });
});

test("a private source forced into the Git index blocks validation before publication", async t => {
  const { paths } = await createProject(t, { site: true });
  const exec = promisify(execFile);
  await exec("git", ["init", "--quiet"], { cwd: paths.root });
  await exec("git", ["add", "--force", "private/family.json"], { cwd: paths.root });
  await assert.rejects(validateProject({ root: paths.root }), { code: "PRIVATE_FILE_TRACKED" });
});
