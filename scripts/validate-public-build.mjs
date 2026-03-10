import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const repoRoot = path.resolve(".");
const privatePath = path.resolve("data/family.private.json");

let privateNodes;
try {
  privateNodes = JSON.parse(await readFile(privatePath, "utf8"));
} catch (error) {
  console.error(`Unable to read ${privatePath}.`);
  console.error("Create the private JSON first, then rerun validation.");
  process.exit(1);
}

const tokens = collectSensitiveTokens(privateNodes);
const ignored = new Set([
  ".git",
  "data/family.private.json"
]);

const files = await collectFiles(repoRoot, ignored);
const findings = [];

for (const filePath of files) {
  const content = await readFile(filePath, "utf8");
  for (const token of tokens) {
    if (content.includes(token)) {
      findings.push({
        filePath,
        token
      });
      break;
    }
  }
}

if (findings.length > 0) {
  console.error("Sensitive plaintext found in published files:");
  for (const finding of findings) {
    console.error(`- ${path.relative(repoRoot, finding.filePath)} contains "${finding.token}"`);
  }
  process.exit(1);
}

console.log(`Validated ${files.length} files. No sensitive plaintext found.`);

function collectSensitiveTokens(nodes) {
  const tokens = new Set();

  for (const node of nodes) {
    const data = node?.data ?? {};
    const firstName = normalizeToken(data["first name"]);
    const lastName = normalizeToken(data["last name"]);

    addToken(tokens, firstName);
    addToken(tokens, lastName);

    if (firstName && lastName) {
      addToken(tokens, `${firstName} ${lastName}`);
    }
  }

  return [...tokens];
}

function addToken(tokens, value) {
  const normalized = normalizeToken(value);
  if (!normalized || normalized.length < 3) {
    return;
  }

  tokens.add(normalized);
}

function normalizeToken(value) {
  if (value === undefined || value === null) {
    return "";
  }

  const normalized = String(value).trim();
  if (!normalized) {
    return "";
  }

  if (normalized === "Name" || normalized === "Surname") {
    return "";
  }

  return normalized;
}

async function collectFiles(directory, ignored) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const relative = path.relative(repoRoot, path.join(directory, entry.name)).replaceAll("\\", "/");
    if (ignored.has(relative) || ignored.has(entry.name)) {
      continue;
    }

    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectFiles(fullPath, ignored);
      files.push(...nested);
      continue;
    }

    files.push(fullPath);
  }

  return files;
}
