import { digest } from "./family-crypto.mjs";

// Public text has identical bytes on Windows and Linux checkouts. Source files,
// encrypted values, and private transaction backups are never rewritten here.
export function publicBytes(relative, content) {
  if (!/\.(?:html|js|css|json|svg)$/.test(relative)) return Buffer.from(content);
  const text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(content);
  return Buffer.from(text.replace(/\r\n?/g, "\n"), "utf8");
}

export const encryptedPayloadDigest = text =>
  digest(publicBytes("data/family.enc.json", Buffer.from(text, "utf8")));
