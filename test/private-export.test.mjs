import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createProject } from "./helpers/project.mjs";
import { assertPrivateFilesNotTracked } from "../scripts/validate-public-build.mjs";

const exec = promisify(execFile);

test("tracking guards reject downloaded private drafts, including browser duplicate filenames", async t => {
  const { paths, nodes } = await createProject(t);
  await mkdir(path.join(paths.root, "exports"));
  await exec("git", ["init", "--quiet"], { cwd: paths.root });
  for (const name of ["family-private-draft.json", "family-private-draft (1).json"]) {
    await writeFile(path.join(paths.root, "exports", name), JSON.stringify(nodes));
    await exec("git", ["add", "--", "exports/" + name], { cwd: paths.root });
    await assert.rejects(assertPrivateFilesNotTracked(paths), { code: "PRIVATE_FILE_TRACKED" });
    await exec("git", ["rm", "--cached", "--", "exports/" + name], { cwd: paths.root });
  }
});
