import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { REPOSITORY_ROOT, FamilyWorkflowError, safeErrorMessage } from "./lib/project-paths.mjs";

const exec = promisify(execFile);
const FICTIONAL_KEY = "test/fixtures/tls/fictional.key.pem";
const FICTIONAL_CERT = "test/fixtures/tls/fictional.cert.pem";
// This key is public test material, never a deployment credential. Pin its exact
// LF-normalized bytes so another key cannot reuse the exception's filename.
const FICTIONAL_KEY_DIGEST = "44cb88c1080487337e2b1094ad6f0c9b602ee28d71ad8d761073921be2a91027";
const SECRET_PATTERN = [
  "-----BEGIN [A-Z ]*PRIVATE KEY-----",
  "(AKIA|ASIA)[A-Z0-9]{16}",
  "gh[pousr]_[A-Za-z0-9]{30,}",
  "github_pat_[A-Za-z0-9_]{50,}",
  "sk-(proj-|svcacct-)?[A-Za-z0-9_-]{32,}"
].join("|");

function forbiddenFile(file) {
  const base = path.posix.basename(file);
  return /^(?:private\/|data\/backups\/|data\/family\.private\.json$|\.aws-sam\/)/i.test(file)
    || /^config\/(?:local|homelab\.local|production\.local)\.json$/i.test(file)
    || /^family-private-draft.*\.json$/i.test(base)
    || (/^\.env(?:\.|$)/i.test(base) && base !== ".env.example")
    || /\.(?:bak|backup|p12|pfx)$/i.test(base)
    || /^(?:id_rsa|id_ed25519)$/i.test(base)
    || (/\.(?:key|pem)$/i.test(base) && ![FICTIONAL_KEY, FICTIONAL_CERT].includes(file));
}

export async function checkGitIndex(root = REPOSITORY_ROOT) {
  async function git(args) {
    return (await exec("git", args, { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024, windowsHide: true })).stdout;
  }
  const tracked = (await git(["ls-files", "--cached", "-z"])).split("\0").filter(Boolean);
  const forbidden = tracked.filter(forbiddenFile);
  if (forbidden.length) throw new FamilyWorkflowError("UNSAFE_GIT_INDEX", "Git index contains " + forbidden.length + " forbidden private, recovery or credential file(s). Inspect the staged file list locally.");
  let fictionalTlsFixture = "absent";
  if (tracked.includes(FICTIONAL_KEY)) {
    const key = (await git(["show", ":" + FICTIONAL_KEY])).replaceAll("\r\n", "\n");
    if (createHash("sha256").update(key).digest("hex") !== FICTIONAL_KEY_DIGEST) {
      throw new FamilyWorkflowError("UNSAFE_TEST_KEY", "The HTTPS test key differs from the pinned public fictional fixture.");
    }
    fictionalTlsFixture = "verified-public-test-material";
  }
  let hits;
  try {
    hits = (await git(["grep", "--cached", "-I", "-l", "-z", "-E", "-e", SECRET_PATTERN, "--", "."]))
      .split("\0").filter(file => file && file !== FICTIONAL_KEY);
  } catch (error) {
    if (error.code !== 1) throw error;
    hits = [];
  }
  if (hits.length) throw new FamilyWorkflowError("POSSIBLE_GIT_SECRET", "Git index contains possible credential material in " + hits.length + " file(s). Values were not printed.");
  const changed = (await git(["diff", "--cached", "--name-only", "-z"])).split("\0").filter(Boolean);
  return { trackedFiles: tracked.length, stagedFiles: changed.length, forbiddenFiles: 0,
    credentialPatternScan: "passed", fictionalTlsFixture };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try { console.log(JSON.stringify(await checkGitIndex(), null, 2)); }
  catch (error) { console.error(safeErrorMessage(error, "Git safety check could not finish. Inspect the local index.")); process.exitCode = 1; }
}
