export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_GALLERY_IMAGES = 24;
export const MEDIA_ID = /^[a-f0-9]{64}$/;
export const IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];
export function imageType(bytes) {
  if (bytes.length >= 24 && [137,80,78,71,13,10,26,10].every((value, index) => bytes[index] === value)) return "image/png";
  if (bytes.length >= 4 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return "image/jpeg";
  if (bytes.length >= 16 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF"
    && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return "";
}
export function galleryIssues(data) {
  const issues = [];
  const gallery = Object.hasOwn(data, "gallery") ? data.gallery : [];
  if (!Array.isArray(gallery) || gallery.length > MAX_GALLERY_IMAGES) return ["Photo gallery must be a list of at most 24 images."];
  const ids = new Set();
  for (const photo of gallery) {
    if (!photo || typeof photo !== "object" || Array.isArray(photo)
      || Object.keys(photo).sort().join() !== "caption,id,name,type" || !MEDIA_ID.test(photo.id)
      || !IMAGE_TYPES.includes(photo.type) || typeof photo.name !== "string" || photo.name.length > 255
      || typeof photo.caption !== "string" || photo.caption.length > 2000 || ids.has(photo.id)) issues.push("Invalid or duplicate gallery image.");
    ids.add(photo?.id);
  }
  if (typeof data.avatar === "string" && data.avatar.startsWith("media:") && !ids.has(data.avatar.slice(6))) issues.push("The main photo must belong to the gallery.");
  return issues;
}
