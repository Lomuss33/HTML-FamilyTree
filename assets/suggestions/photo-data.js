import { IMAGE_TYPES, MEDIA_ID } from "../viewer/media-data.js";

export const MAX_SUGGESTION_PHOTOS = 6;
export const PHOTO_TOKEN = /^[a-f0-9]{64}$/;
export function safePhotoName(value, type) {
  const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[type];
  if (!extension) throw new Error("Unsupported photo type.");
  const base = String(value ?? "fotografija").replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "")
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, "_").trim().slice(0, 180) || "fotografija";
  return base + extension;
}
export function validSuggestionPhoto(photo) {
  return photo && typeof photo === "object" && !Array.isArray(photo)
    && Object.keys(photo).sort().join() === "caption,id,name,type"
    && typeof photo.id === "string" && MEDIA_ID.test(photo.id) && IMAGE_TYPES.includes(photo.type)
    && typeof photo.name === "string" && photo.name === safePhotoName(photo.name, photo.type)
    && typeof photo.caption === "string" && photo.caption.length <= 2000;
}
