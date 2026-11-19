import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, open, link, unlink, stat } from "node:fs/promises";
import path from "node:path";
import { assertSafePath, FamilyWorkflowError } from "./project-paths.mjs";
import { MAX_IMAGE_BYTES, MEDIA_ID, IMAGE_TYPES, imageType } from "../../assets/viewer/media-data.js";

const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export function createMediaStore(paths) {
  async function read(id) {
    if (!MEDIA_ID.test(id)) throw new FamilyWorkflowError("INVALID_MEDIA", "Invalid photo identifier.");
    const file = await assertSafePath(paths.root, path.join(paths.media, id + ".image"));
    let bytes;
    try {
      const info = await stat(file);
      if (!info.isFile() || info.size > MAX_IMAGE_BYTES) throw new FamilyWorkflowError("MEDIA_CORRUPT", "Photo verification failed. The stored file was preserved.", 409);
      bytes = await readFile(file);
    }
    catch (error) { if (error.code === "ENOENT") throw new FamilyWorkflowError("MEDIA_NOT_FOUND", "The photo is unavailable. Keep its recovery copies.", 404); throw error; }
    const type = imageType(bytes);
    if (!type || bytes.length > MAX_IMAGE_BYTES || hash(bytes) !== id) throw new FamilyWorkflowError("MEDIA_CORRUPT", "Photo verification failed. The stored file was preserved.", 409);
    return { bytes, type };
  }
  async function put(bytes, type) {
    if (!Buffer.isBuffer(bytes) || bytes.length > MAX_IMAGE_BYTES) throw new FamilyWorkflowError("PAYLOAD_TOO_LARGE", "Each photo may be at most 8 MB.", 413);
    if (!IMAGE_TYPES.includes(type) || imageType(bytes) !== type) throw new FamilyWorkflowError("INVALID_MEDIA", "Choose a JPEG, PNG or WebP photo.", 415);
    const id = hash(bytes);
    await assertSafePath(paths.root, paths.media);
    await mkdir(paths.media, { recursive: true, mode: 0o700 });
    const target = await assertSafePath(paths.root, path.join(paths.media, id + ".image"));
    const temporary = await assertSafePath(paths.root, path.join(paths.media, "upload-" + randomUUID()));
    const handle = await open(temporary, "wx", 0o600);
    try { await handle.writeFile(bytes); await handle.sync(); } finally { await handle.close(); }
    try {
      // Atomic, append-only publication. Existing bytes are never overwritten.
      try { await link(temporary, target); } catch (error) { if (error.code !== "EEXIST") throw error; }
      const verified = await read(id);
      if (verified.type !== type) throw new FamilyWorkflowError("MEDIA_CORRUPT", "Photo verification failed.", 409);
      return { id, type };
    } finally { await unlink(temporary); }
  }
  return { read, put, async putEncoded(content, type) {
    if (typeof content !== "string" || content.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4) throw new FamilyWorkflowError("PAYLOAD_TOO_LARGE", "Each photo may be at most 8 MB.", 413);
    const bytes = Buffer.from(content, "base64");
    if (bytes.toString("base64") !== content) throw new FamilyWorkflowError("INVALID_MEDIA", "Invalid photo encoding.");
    return put(bytes, type);
  } };
}

export async function verifyFamilyMedia(paths, nodes) {
  const media = createMediaStore(paths);
  const verified = new Map();
  for (const person of nodes) for (const photo of person.data?.gallery ?? []) {
    if (!verified.has(photo.id)) verified.set(photo.id, (await media.read(photo.id)).type);
    if (verified.get(photo.id) !== photo.type) throw new FamilyWorkflowError("INVALID_MEDIA", "The photo reference does not match its stored type.");
  }
}

export async function copyFamilyMedia(sourcePaths, targetPaths, nodes) {
  const source = createMediaStore(sourcePaths);
  const target = createMediaStore(targetPaths);
  const copied = new Set();
  for (const person of nodes) for (const photo of person.data?.gallery ?? []) {
    if (copied.has(photo.id)) continue;
    const { bytes, type } = await source.read(photo.id);
    if (type !== photo.type) throw new FamilyWorkflowError("INVALID_MEDIA", "Backup photo type does not match its reference.");
    const stored = await target.put(bytes, type);
    if (stored.id !== photo.id) throw new FamilyWorkflowError("MEDIA_CORRUPT", "Photo backup verification failed.");
    copied.add(photo.id);
  }
  return copied.size;
}
