import { pbkdf2Sync, randomBytes, createCipheriv } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const defaults = {
  input: path.resolve("data/family.private.json"),
  output: path.resolve("data/family.enc.json"),
  iterations: 250000
};

const options = parseArgs(process.argv.slice(2));
const password = options.password ?? process.env.FAMILY_TREE_PASSWORD;

if (!password) {
  console.error("Missing password. Use --password or set FAMILY_TREE_PASSWORD.");
  process.exit(1);
}

const inputPath = path.resolve(options.input ?? defaults.input);
const outputPath = path.resolve(options.output ?? defaults.output);
const iterations = Number(options.iterations ?? defaults.iterations);

if (!Number.isInteger(iterations) || iterations < 100000) {
  console.error("Iterations must be an integer of at least 100000.");
  process.exit(1);
}

const plaintext = await readFile(inputPath, "utf8");
const familyNodes = JSON.parse(plaintext);
if (!Array.isArray(familyNodes)) {
  console.error("Input JSON must be an array of family nodes.");
  process.exit(1);
}

const normalizedPlaintext = `${JSON.stringify(familyNodes, null, 2)}\n`;
const salt = randomBytes(16);
const iv = randomBytes(12);
const key = pbkdf2Sync(password, salt, iterations, 32, "sha256");
const cipher = createCipheriv("aes-256-gcm", key, iv);
const ciphertext = Buffer.concat([
  cipher.update(normalizedPlaintext, "utf8"),
  cipher.final()
]);
const tag = cipher.getAuthTag();

const payload = {
  version: 1,
  kdf: "PBKDF2",
  hash: "SHA-256",
  iterations,
  salt: salt.toString("base64"),
  iv: iv.toString("base64"),
  ciphertext: Buffer.concat([ciphertext, tag]).toString("base64")
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");

console.log(`Encrypted ${familyNodes.length} family nodes to ${outputPath}`);

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument.startsWith("--")) {
      continue;
    }

    const key = argument.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[key] = true;
      continue;
    }

    parsed[key] = value;
    index += 1;
  }

  return parsed;
}
