import { pathToFileURL } from "node:url";
import path from "node:path";
import { projectPaths, parseArgs } from "./lib/project-paths.mjs";
import { migrateFamily } from "./lib/migrate-family.mjs";

export async function runMigration(args = process.argv.slice(2)) {
  const options = parseArgs(args);
  const report = await migrateFamily(projectPaths(options.root), {
    dryRun: options["dry-run"] === true,
    keepExistingAnchors: options["keep-existing-anchors"] === true
  });
  console.log(JSON.stringify(report, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await runMigration().catch(error => { console.error(error.code ?? "MIGRATION_FAILED", "Migration stopped; inspect the local source and recovery copies."); process.exitCode = 1; });
}
