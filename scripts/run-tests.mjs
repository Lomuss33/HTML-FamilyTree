import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { REPOSITORY_ROOT } from "./lib/project-paths.mjs";

const files = [];
for (const directory of ["test", "api/test"]) {
  for (const name of (await readdir(path.join(REPOSITORY_ROOT, directory))).sort()) {
    if (name.endsWith(".test.mjs")) files.push(path.join(REPOSITORY_ROOT, directory, name));
  }
}
const child = spawn(process.execPath, ["--test", ...files], { cwd: REPOSITORY_ROOT, stdio: "inherit" });
child.on("error", () => { console.error("The test runner could not start."); process.exitCode = 1; });
child.on("exit", code => { process.exitCode = code ?? 1; });
