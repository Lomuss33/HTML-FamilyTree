import { runPreparation } from "./prepare-family.mjs";
import { safeErrorMessage } from "./lib/project-paths.mjs";

// Encryption of the live edition always prepares the complete artifact set.
await runPreparation().catch(error => {
  console.error(error.code ?? "ENCRYPTION_FAILED", safeErrorMessage(error));
  process.exitCode = 1;
});
