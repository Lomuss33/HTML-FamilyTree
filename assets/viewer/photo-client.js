import { photoUploadPayload } from "./photo-file.js";

export function createPhotoClient({ api, credentials, readPhoto }) {
  const previews = new Map();
  let generation = 0;
  let queue = Promise.resolve();
  let fullView = null;
  function auth() {
    const value = credentials?.();
    if (!value?.password || !value.payloadDigest) throw new Error("Za fotografije je potreban privatni lokalni pristup.");
    return value;
  }
  const read = id => readPhoto ? readPhoto(id) : api.readPhoto({ ...auth(), id });
  async function resize(blob) {
    const raw = URL.createObjectURL(blob);
    try {
      const image = new Image();
      image.src = raw;
      await image.decode();
      const scale = Math.min(1, 512 / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
      const thumbnail = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!thumbnail) throw new Error("Fotografija se ne može prikazati.");
      return URL.createObjectURL(thumbnail);
    } finally { URL.revokeObjectURL(raw); }
  }
  function preview(id) {
    if (previews.has(id)) return previews.get(id);
    const current = generation;
    const pending = queue.then(async () => {
      if (current !== generation) throw new Error("Privatni pristup je zatvoren.");
      const blob = await read(id);
      const url = await resize(blob);
      if (current !== generation) { URL.revokeObjectURL(url); throw new Error("Privatni pristup je zatvoren."); }
      return url;
    });
    previews.set(id, pending);
    void pending.catch(() => { if (previews.get(id) === pending) previews.delete(id); });
    queue = pending.catch(() => {});
    return pending;
  }
  return {
    preview,
    async upload(file) {
      const current = generation;
      const { type, content, name } = await photoUploadPayload(file);
      const result = await api.uploadPhoto({ ...auth(), type, content });
      if (current !== generation) throw new Error("Privatni pristup je zatvoren.");
      return { id: result.id, type: result.type, name, caption: "" };
    },
    async show(photo) {
      const current = generation;
      const blob = await read(photo.id);
      if (current !== generation) return;
      const url = URL.createObjectURL(blob);
      const dialog = document.createElement("dialog");
      dialog.className = "photo-dialog";
      dialog.setAttribute("aria-label", "Fotografija");
      const close = document.createElement("button");
      close.type = "button"; close.className = "secondary-button"; close.textContent = "Zatvori fotografiju";
      close.addEventListener("click", () => dialog.close());
      const image = document.createElement("img"); image.src = url; image.alt = photo.caption || photo.name;
      const download = document.createElement("a"); download.href = url; download.download = photo.name;
      download.textContent = "Preuzmi izvornu fotografiju";
      dialog.append(close, image, download);
      dialog.addEventListener("close", () => { URL.revokeObjectURL(url); dialog.remove(); if (fullView === dialog) fullView = null; }, { once: true });
      if (fullView) fullView.close();
      fullView = dialog;
      document.body.append(dialog); dialog.showModal();
    },
    clear() {
      ++generation;
      if (fullView) fullView.close();
      for (const pending of previews.values()) void pending.then(url => URL.revokeObjectURL(url), () => {});
      previews.clear();
      queue = Promise.resolve();
    }
  };
}
