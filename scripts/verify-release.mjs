import { parseArgs, projectPaths, safeErrorMessage } from "./lib/project-paths.mjs";
import { verifyRelease } from "./lib/release.mjs";
import { validateProject } from "./validate-public-build.mjs";

try {
  const paths = projectPaths(parseArgs(process.argv.slice(2)).root);
  await validateProject({ root: paths.root, outputDirectory: paths.dist });
  console.log(JSON.stringify(await verifyRelease(paths), null, 2));
} catch (error) { console.error(error.code ?? "RELEASE_FAILED", safeErrorMessage(error)); process.exitCode = 1; }
