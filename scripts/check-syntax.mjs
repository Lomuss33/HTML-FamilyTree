import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { REPOSITORY_ROOT } from "./lib/project-paths.mjs";

async function collect(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules") continue;
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await collect(file));
    else if (/\.(?:mjs|js)$/.test(entry.name)) files.push(file);
  }
  return files;
}
let count = 0;
for (const directory of ["assets", "scripts", "test", "api/src", "api/test"]) {
  for (const file of await collect(path.join(REPOSITORY_ROOT, directory))) {
    const result = spawnSync(process.execPath, ["--check", file], { encoding: "utf8" });
    if (result.status !== 0) { console.error(result.stderr || "Syntax check failed."); process.exit(1); }
    count++;
  }
}
console.log("Syntax checked " + count + " JavaScript modules.");
