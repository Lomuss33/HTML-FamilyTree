import { createCipheriv, createDecipheriv, createHash, pbkdf2, randomBytes } from "node:crypto";
import { promisify } from "node:util";
import { FamilyWorkflowError } from "./project-paths.mjs";
import { stableStringify } from "../validate-family-data.mjs";

const derive = promisify(pbkdf2);
export const DEFAULT_ITERATIONS = 250000;
export const jsonText = (value) => JSON.stringify(value, null, 2) + "\n";
export const digest = (value) => "sha256:" + createHash("sha256").update(value).digest("hex");
export const familyRevision = (nodes) => digest("personal-family-full-v1\n" + stableStringify(nodes));

function decode(value, length) {
  if (typeof value !== "string" || !value || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)) {
    throw new FamilyWorkflowError("INVALID_ENVELOPE", "The encrypted payload contains invalid base64.");
  }
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (length && bytes.length !== length)) {
    throw new FamilyWorkflowError("INVALID_ENVELOPE", "The encrypted payload has invalid field lengths.");
  }
  return bytes;
}

export function validateEncryptedPayload(payload) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || Object.keys(payload).sort().join(",") !== "ciphertext,hash,iterations,iv,kdf,salt,version"
    || payload.version !== 1 || payload.kdf !== "PBKDF2" || payload.hash !== "SHA-256"
    || !Number.isInteger(payload.iterations) || payload.iterations < 100000 || payload.iterations > 2000000) {
    throw new FamilyWorkflowError("INVALID_ENVELOPE", "The encrypted payload format or work factor is unsupported.");
  }
  decode(payload.salt, 16);
  decode(payload.iv, 12);
  const ciphertext = decode(payload.ciphertext);
  if (ciphertext.length < 17 || ciphertext.length > 2 * 1024 * 1024) {
    throw new FamilyWorkflowError("INVALID_ENVELOPE", "The encrypted payload has an invalid size.");
  }
  return payload;
}

function validatePassword(password) {
  if (typeof password !== "string" || !password || password.length > 1024) {
    throw new FamilyWorkflowError("PASSWORD_REQUIRED", "Enter the family password locally.");
  }
}

export async function encryptFamily(nodes, password, { iterations = DEFAULT_ITERATIONS } = {}) {
  validatePassword(password);
  if (!Number.isInteger(iterations) || iterations < 100000 || iterations > 2000000) {
    throw new FamilyWorkflowError("INVALID_ENVELOPE", "Unsupported PBKDF2 work factor.");
  }
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await derive(password, salt, iterations, 32, "sha256");
  try {
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(jsonText(nodes), "utf8"), cipher.final(), cipher.getAuthTag()]);
    return { version: 1, kdf: "PBKDF2", hash: "SHA-256", iterations, salt: salt.toString("base64"), iv: iv.toString("base64"), ciphertext: ciphertext.toString("base64") };
  } finally { key.fill(0); }
}

export async function decryptFamily(payload, password) {
  validatePassword(password);
  validateEncryptedPayload(payload);
  const key = await derive(password, decode(payload.salt), payload.iterations, 32, "sha256");
  try {
    const data = decode(payload.ciphertext);
    const decipher = createDecipheriv("aes-256-gcm", key, decode(payload.iv));
    decipher.setAuthTag(data.subarray(-16));
    const plaintext = Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString("utf8");
    return JSON.parse(plaintext);
  } catch {
    throw new FamilyWorkflowError("UNLOCK_FAILED", "The password or encrypted payload could not be verified.", 403);
  } finally { key.fill(0); }
}
