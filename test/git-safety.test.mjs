import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { checkGitIndex } from "../scripts/check-git.mjs";
import { REPOSITORY_ROOT } from "../scripts/lib/project-paths.mjs";
import { createProject } from "./helpers/project.mjs";

const exec = promisify(execFile);
async function project(t) {
  const { paths } = await createProject(t);
  const git = args => exec("git", args, { cwd: paths.root, windowsHide: true });
  await git(["init", "--quiet"]);
  await writeFile(path.join(paths.root, ".gitignore"), await readFile(path.join(REPOSITORY_ROOT, ".gitignore")));
  await writeFile(path.join(paths.root, "README.md"), "Fictional Git safety fixture.\n");
  return { paths, git };
}

test("ordinary git add excludes private data, local configuration, secrets and recovery files while retaining fictional TLS fixtures", async t => {
  const { paths, git } = await project(t);
  const excluded = [".env", ".env.local", "data/family.enc.json.pre-recovery.bak", "config/homelab.local.json",
    "config/local.json", "config/production.local.json", "exports/family-private-draft (1).json", "server.key.pem", "id_ed25519"];
  for (const file of excluded) {
    await mkdir(path.dirname(path.join(paths.root, file)), { recursive: true });
    await writeFile(path.join(paths.root, file), "fictional private canary");
  }
  await mkdir(path.join(paths.root, "test/fixtures/tls"), { recursive: true });
  for (const file of ["fictional.key.pem", "fictional.cert.pem"]) {
    await writeFile(path.join(paths.root, "test/fixtures/tls", file), await readFile(path.join(REPOSITORY_ROOT, "test/fixtures/tls", file)));
  }
  await git(["add", "."]);
  const { stdout } = await git(["ls-files", "--cached", "-z"]);
  const files = stdout.split("\0");
  for (const file of ["private/family.json", ...excluded]) assert.equal(files.includes(file), false, file);
  assert.equal((await checkGitIndex(paths.root)).fictionalTlsFixture, "verified-public-test-material");
});

test("Git check rejects forced recovery tracking and scans staged content even when the working copy is clean", async t => {
  const { paths, git } = await project(t);
  const backup = path.join(paths.root, "data/recovery.bak");
  await writeFile(backup, "fictional recovery canary");
  await git(["add", "-f", "--", "data/recovery.bak"]);
  await assert.rejects(checkGitIndex(paths.root), { code: "UNSAFE_GIT_INDEX" });
  await git(["rm", "--cached", "--", "data/recovery.bak"]);
  const secret = ["AKIA", "A".repeat(16)].join("");
  await writeFile(path.join(paths.root, "settings.js"), 'export const credential = "' + secret + '";\n');
  await git(["add", "--", "settings.js"]);
  await writeFile(path.join(paths.root, "settings.js"), "export const credential = null;\n");
  await assert.rejects(checkGitIndex(paths.root), error => error.code === "POSSIBLE_GIT_SECRET" && !error.message.includes(secret));
  await git(["add", "--", "settings.js"]);
  assert.equal((await checkGitIndex(paths.root)).credentialPatternScan, "passed");
  assert.equal(await readFile(backup, "utf8"), "fictional recovery canary");
});

test("a real private key cannot reuse the fictional TLS filename exception", async t => {
  const { paths, git } = await project(t);
  const file = "test/fixtures/tls/fictional.key.pem";
  await mkdir(path.dirname(path.join(paths.root, file)), { recursive: true });
  await writeFile(path.join(paths.root, file), ["-----BEGIN ", "PRIVATE KEY-----\nfictional replacement\n"].join(""));
  await git(["add", "--", file]);
  await assert.rejects(checkGitIndex(paths.root), { code: "UNSAFE_TEST_KEY" });
});
