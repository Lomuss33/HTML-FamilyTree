import { MAX_IMAGE_BYTES, imageType } from "./media-data.js";
import { safePhotoName } from "../suggestions/photo-data.js";

export async function readPhotoFile(file) {
  if (file.name.length > 255) throw new Error("Naziv datoteke može imati najviše 255 znakova.");
  if (file.size > MAX_IMAGE_BYTES) throw new Error("Fotografija može imati najviše 8 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const type = imageType(bytes);
  if (!type) throw new Error("Odaberi JPEG, PNG ili WebP fotografiju.");
  const url = URL.createObjectURL(file);
  try { const image = new Image(); image.src = url; await image.decode(); }
  catch { throw new Error("Odabrana datoteka nije čitljiva fotografija."); }
  finally { URL.revokeObjectURL(url); }
  return { bytes, type, name: safePhotoName(file.name, type) };
}
export async function photoUploadPayload(file) {
  const { bytes, ...metadata } = await readPhotoFile(file);
  let text = "";
  for (let index = 0; index < bytes.length; index += 32768) text += String.fromCharCode(...bytes.subarray(index, index + 32768));
  return { ...metadata, content: btoa(text) };
}
