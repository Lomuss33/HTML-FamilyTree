import { readPhotoFile, photoUploadPayload } from "../viewer/photo-file.js";
import { MAX_SUGGESTION_PHOTOS } from "./photo-data.js";
import { uploadSuggestionPhoto } from "./submission-api.js";

export function createSuggestionPhotoPicker(root) {
  const input = root.querySelector('input[type="file"]');
  const list = root.querySelector(".suggestion-photo-list");
  const status = root.querySelector(".suggestion-photo-status");
  let entries = [], generation = 0, busy = false, enabled = false;
  function render() {
    list.replaceChildren();
    for (const entry of entries) {
      const row = document.createElement("div"); row.className = "suggestion-photo-item";
      const image = document.createElement("img"); image.src = entry.url; image.alt = entry.name;
      const label = document.createElement("label"); label.className = "field";
      const title = document.createElement("span"); title.textContent = "Opis fotografije: " + entry.name;
      const caption = document.createElement("input"); caption.type = "text"; caption.maxLength = 2000; caption.value = entry.caption;
      caption.disabled = busy; caption.addEventListener("input", () => { entry.caption = caption.value; });
      label.append(title, caption);
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary-button";
      remove.textContent = "Ukloni fotografiju"; remove.disabled = busy;
      remove.addEventListener("click", () => { entries = entries.filter(value => value !== entry); URL.revokeObjectURL(entry.url); render(); });
      row.append(image, label, remove); list.append(row);
    }
    input.disabled = busy || !enabled;
  }
  input.addEventListener("change", () => void (async () => {
    const current = generation;
    const files = [...input.files]; input.value = "";
    if (entries.length + files.length > MAX_SUGGESTION_PHOTOS) { status.textContent = "Uz prijedlog možeš dodati najviše šest fotografija."; return; }
    busy = true; render(); status.textContent = "Provjeravam fotografije…";
    try {
      for (const file of files) {
        const { name, bytes } = await readPhotoFile(file);
        const fingerprint = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(value => value.toString(16).padStart(2, "0")).join("");
        if (current !== generation) return;
        if (!entries.some(entry => entry.fingerprint === fingerprint)) entries.push({ file, name, fingerprint, caption: "", token: null, url: URL.createObjectURL(file) });
      }
      status.textContent = "Fotografije čekaju slanje i administratorov pregled.";
    } catch (error) { if (current === generation) status.textContent = error.message; }
    finally { if (current === generation) { busy = false; render(); } }
  })());
  function clear() {
    generation++; for (const entry of entries) URL.revokeObjectURL(entry.url);
    entries = []; busy = false; input.value = ""; status.textContent = ""; render();
  }
  return {
    setEnabled(value) { enabled = value === true; root.hidden = !enabled; if (!enabled) clear(); else render(); },
    clear,
    hasFiles: () => entries.length > 0,
    isBusy: () => busy,
    async tokens(accessCode) {
      if (!enabled) return [];
      if (busy) throw new Error("Pričekaj završetak provjere fotografija pa ponovno pošalji prijedlog.");
      if (!entries.length) return [];
      const current = generation; busy = true; render();
      try {
        for (const entry of entries) {
          if (!entry.token) {
            status.textContent = "Šaljem fotografiju: " + entry.name;
            const payload = await photoUploadPayload(entry.file);
            const result = await uploadSuggestionPhoto({ ...payload, accessCode });
            if (current !== generation) throw new Error("Slanje fotografije je zatvoreno.");
            entry.token = result.token;
          }
        }
        status.textContent = "Fotografije su učitane za ovaj prijedlog.";
        return entries.map(entry => ({ token: entry.token, caption: entry.caption }));
      } catch (error) {
        if (current === generation) status.textContent = error.message;
        throw error;
      } finally { if (current === generation) { busy = false; render(); } }
    }
  };
}
