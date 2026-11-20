import { readFile, readdir, lstat } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const root = path.resolve(process.argv[2] ?? "restored/family-tree-migration");
const hash = data => createHash("sha256").update(data).digest("hex");
async function walk(directory, prefix = "") {
  const found = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? prefix + "/" + entry.name : entry.name;
    const file = path.join(directory, entry.name);
    const stat = await lstat(file);
    if (stat.isSymbolicLink()) throw new Error("Linked file refused.");
    if (stat.isDirectory()) found.push(...await walk(file, relative));
    else if (stat.isFile()) { const bytes = await readFile(file); found.push({ path: relative, bytes: bytes.length, sha256: hash(bytes) }); }
    else throw new Error("Unsupported restored entry.");
  }
  return found.sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
}
try {
  const manifest = JSON.parse(await readFile(path.join(root, "inventory.json"), "utf8"));
  if (manifest.version !== 1 || !Array.isArray(manifest.files)) throw new Error("Invalid inventory.");
  for (const entry of manifest.files) {
    if (typeof entry.path !== "string" || entry.path.includes("\\") || entry.path.includes(":")
      || entry.path.split("/").some(part => !part || part === "." || part === "..")
      || !/^[a-f0-9]{64}$/.test(entry.sha256)) throw new Error("Unsafe inventory.");
  }
  const actual = await walk(path.join(root, "project"));
  if (JSON.stringify(actual) !== JSON.stringify(manifest.files)) throw new Error("Restored inventory differs.");
  console.log(JSON.stringify({ verified: true, files: actual.length, privateFiles: actual.filter(f => f.path.startsWith("private/")).length }));
} catch { console.error("RESTORE_VERIFICATION_FAILED: restored files do not match the encrypted inventory."); process.exitCode = 1; }
