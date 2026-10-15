import { parseArgs, projectPaths } from "./lib/project-paths.mjs";
import { inspectTransactions, recoverTransactions } from "./lib/file-transaction.mjs";

const options = parseArgs(process.argv.slice(2));
try {
  const paths = projectPaths(options.root);
  const result = options.inspect
    ? (await inspectTransactions(paths)).map(({ journal }) => ({ operationId: journal.operationId, state: journal.state }))
    : await recoverTransactions(paths);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(error.code ?? "RECOVERY_FAILED", "Recovery needs local inspection. Existing evidence was retained."); process.exitCode = 1; }
