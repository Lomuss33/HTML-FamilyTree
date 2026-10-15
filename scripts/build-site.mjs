import path from "node:path";
import { pathToFileURL } from "node:url";
import { projectPaths, parseArgs } from "./lib/project-paths.mjs";
import { buildSite } from "./lib/publication.mjs";

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const options = parseArgs(process.argv.slice(2));
  try {
    const result = await buildSite(projectPaths(options.root), { environment: options.environment ?? "local" });
    console.log(JSON.stringify({ environment: result.environment, files: result.inventory.length, siteDigest: result.siteDigest, catalogVersion: result.catalogVersion, sourceRevision: result.sourceRevision }, null, 2));
  } catch (error) { console.error(error.code ?? "BUILD_FAILED", "Site assembly stopped. Inspect the approved input files and metadata."); process.exitCode = 1; }
}
