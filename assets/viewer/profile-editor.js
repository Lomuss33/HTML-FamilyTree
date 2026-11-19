import { PROFILE_FIELDS, profileDataIssues } from "./profile-data.js";
import { MAX_GALLERY_IMAGES } from "./media-data.js";

export function createProfileEditor(person, onApply, photos) {
  const element = (tag, text, className) => {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  };
  const form = element("form", undefined, "person-profile-form");
  form.noValidate = true;
  const core = element("details", undefined, "person-edit");
  core.append(element("summary", "Uredi podatke osobe"));
  const inputs = {};
  for (const field of PROFILE_FIELDS) {
    const label = element("label", undefined, "field");
    const input = element(field.multiline ? "textarea" : "input");
    if (field.multiline) input.rows = field.key === "notes" ? 6 : 3;
    else input.type = "text";
    input.name = field.key;
    input.defaultValue = person.data?.[field.key] ?? "";
    input.autocomplete = "off";
    label.append(element("span", field.label), input);
    if (field.hint) label.append(element("small", field.hint));
    inputs[field.key] = input;
    core.append(label);
  }
  const residences = element("section", undefined, "residence-editor");
  residences.append(element("h4", "Mjesta života"),
    element("p", "Dodaj mjesta redom kojim ih želiš voditi. Od i do mogu biti datum, godina ili približan podatak; prazno znači da podatak nije upisan.", "people-empty"));
  const rows = element("div", undefined, "residence-rows");
  const initialResidences = structuredClone(person.data?.residences ?? []);
  function addResidence(entry = { place: "", from: "", to: "" }) {
    const row = element("fieldset", undefined, "residence-row");
    row.append(element("legend", "Razdoblje života"));
    for (const [key, title] of [["place", "Mjesto"], ["from", "Od"], ["to", "Do"]]) {
      const label = element("label", undefined, "field");
      const input = element("input");
      input.type = "text";
      input.dataset.residence = key;
      input.setAttribute("aria-label", title);
      input.defaultValue = entry[key];
      input.addEventListener("input", () => row.querySelector('[data-residence="place"]').setCustomValidity(""));
      label.append(element("span", title), input);
      row.append(label);
    }
    const remove = element("button", "Ukloni razdoblje", "secondary-button");
    remove.type = "button";
    remove.addEventListener("click", () => row.remove());
    row.append(remove);
    rows.append(row);
  }
  for (const entry of initialResidences) addResidence(entry);
  const add = element("button", "Dodaj mjesto života", "secondary-button");
  add.type = "button";
  add.addEventListener("click", () => { addResidence(); rows.lastElementChild.querySelector("input").focus(); });
  residences.append(rows, add);
  core.append(residences);
  form.append(core);
  const initialGallery = structuredClone(person.data?.gallery ?? []);
  let gallery = structuredClone(initialGallery);
  let avatar = person.data?.avatar ?? "";
  let busy = false;
  let uploadGeneration = 0;
  const photoSection = element("details", undefined, "person-photos-editor");
  photoSection.append(element("summary", "Glavna fotografija i galerija"),
    element("p", "JPEG, PNG ili WebP, do 8 MB po fotografiji. Izvorne datoteke čuvaju se u privatnoj arhivi. Uklanjanje iz profila ne briše datoteku.", "people-empty"));
  const photoStatus = element("p", "", "status-message");
  photoStatus.setAttribute("role", "status");
  const photoList = element("div", undefined, "photo-editor-list");
  function renderPhotos() {
    photoList.replaceChildren();
    for (const photo of gallery) {
      const item = element("div", undefined, "photo-editor-item");
      const image = element("img"); image.alt = photo.caption || photo.name;
      void photos.preview(photo.id).then(url => { if (image.isConnected) image.src = url; }, () => {});
      const main = element("button", avatar === "media:" + photo.id ? "Glavna fotografija" : "Postavi kao glavnu", "secondary-button");
      main.type = "button";
      main.addEventListener("click", () => { avatar = "media:" + photo.id; renderPhotos(); });
      const remove = element("button", "Ukloni iz profila", "secondary-button"); remove.type = "button";
      remove.addEventListener("click", () => {
        gallery = gallery.filter(value => value.id !== photo.id);
        if (avatar === "media:" + photo.id) avatar = "";
        renderPhotos();
      });
      const caption = element("label", undefined, "field");
      const input = element("input"); input.type = "text"; input.maxLength = 2000; input.defaultValue = photo.caption;
      input.addEventListener("input", () => { photo.caption = input.value; });
      caption.append(element("span", "Opis fotografije"), input);
      item.append(image, element("span", photo.name), caption, main, remove);
      photoList.append(item);
    }
  }
  for (const [isMain, title] of [[true, "Dodaj glavnu fotografiju"], [false, "Dodaj fotografije u galeriju"]]) {
    const label = element("label", undefined, "field");
    const input = element("input"); input.type = "file"; input.accept = "image/jpeg,image/png,image/webp";
    input.multiple = !isMain; input.name = isMain ? "main-photo" : "gallery-photos";
    input.addEventListener("change", async () => {
      if (busy) return;
      const current = uploadGeneration;
      busy = true; apply.disabled = true;
      photoStatus.textContent = "Spremanje fotografija u privatnu arhivu…";
      try {
        for (const file of input.files) {
          const photo = await photos.upload(file);
          if (current !== uploadGeneration) return;
          if (!gallery.some(value => value.id === photo.id)) {
            if (gallery.length >= MAX_GALLERY_IMAGES) throw new Error("Galerija može imati najviše 24 fotografije.");
            gallery.push(photo);
          }
          if (isMain) avatar = "media:" + photo.id;
          renderPhotos();
        }
        photoStatus.textContent = "Fotografije su u nacrtu profila. Klikni Primijeni u nacrt, zatim Save za cijelo stablo.";
      } catch (error) { if (current === uploadGeneration) photoStatus.textContent = error.message || "Prijenos nije uspio. Ostali podaci su zadržani."; }
      finally { if (current === uploadGeneration) { busy = false; apply.disabled = false; input.value = ""; } }
    });
    label.append(element("span", title), input); photoSection.append(label);
  }
  photoSection.append(photoList, photoStatus); form.append(photoSection);
  renderPhotos();

  const privacy = element("details", undefined, "person-privacy");
  privacy.append(element("summary", "Javna vidljivost"));
  const toggle = element("label", undefined, "person-privacy-toggle");
  const checkbox = element("input");
  checkbox.type = "checkbox";
  checkbox.name = "publicAnchor";
  checkbox.defaultChecked = person.privacy?.publicAnchor === true;
  toggle.append(checkbox, element("span", "Prikaži ovu osobu javno"));
  privacy.append(toggle, element("p", "Javne su samo oznake koje ovdje odobriš. Ostali podaci profila ostaju privatni. Veze između javnih osoba prikazuju se automatski.", "people-empty"));
  const publicInputs = {};
  for (const [key, title] of [["publicLabel", "Javna oznaka osobe"], ["publicLifespan", "Javne godine (neobavezno)"], ["publicBranchLabel", "Javna oznaka grane (neobavezno)"]]) {
    const label = element("label", undefined, "field");
    const input = element("input");
    input.type = "text";
    input.name = key;
    input.autocomplete = "off";
    input.defaultValue = person.privacy?.[key] ?? "";
    input.addEventListener("input", () => input.setCustomValidity(""));
    publicInputs[key] = input;
    label.append(element("span", title), input);
    privacy.append(label);
  }
  function updatePublicFields() {
    for (const input of Object.values(publicInputs)) input.disabled = !checkbox.checked;
    publicInputs.publicLabel.required = checkbox.checked;
    publicInputs.publicLabel.setCustomValidity("");
  }
  checkbox.addEventListener("change", updatePublicFields);
  updatePublicFields();
  form.append(privacy);
  const apply = element("button", "Primijeni u nacrt", "secondary-button");
  apply.type = "submit";
  const status = element("p", "", "status-message");
  status.id = "person-privacy-status";
  status.setAttribute("role", "status");
  form.append(apply, status);

  function readResidences(validate = false) {
    return [...rows.children].map(row => {
      const entry = Object.fromEntries([...row.querySelectorAll("input")].map(input => [input.dataset.residence, input.value]));
      if (validate) row.querySelector('[data-residence="place"]').setCustomValidity(
        !entry.place.trim() && (entry.from.trim() || entry.to.trim()) ? "Upiši mjesto za ovo razdoblje." : "");
      return entry;
    }).filter(entry => Object.values(entry).some(value => value.trim()));
  }
  function dataPatch() {
    const patch = Object.fromEntries(Object.entries(inputs).filter(([key, input]) => input.value !== (person.data?.[key] ?? ""))
      .map(([key, input]) => [key, input.value]));
    const entries = readResidences();
    if (JSON.stringify(entries) !== JSON.stringify(initialResidences)) patch.residences = entries;
    if (JSON.stringify(gallery) !== JSON.stringify(initialGallery)) patch.gallery = structuredClone(gallery);
    if (avatar !== (person.data?.avatar ?? "")) patch.avatar = avatar;
    return patch;
  }
  const controller = {
    form,
    dispose() { ++uploadGeneration; busy = false; },
    hasDraft() {
      return busy || Object.keys(dataPatch()).length > 0 || checkbox.checked !== checkbox.defaultChecked
        || Object.values(publicInputs).some(input => input.value !== input.defaultValue);
    },
    reset() {
      ++uploadGeneration; busy = false; apply.disabled = false;
      gallery = structuredClone(initialGallery); avatar = person.data?.avatar ?? ""; renderPhotos();
      form.reset();
      rows.replaceChildren();
      for (const entry of initialResidences) addResidence(entry);
      updatePublicFields();
    }
  };
  form.addEventListener("submit", event => {
    event.preventDefault();
    if (busy) return;
    readResidences(true);
    publicInputs.publicLabel.setCustomValidity(checkbox.checked && !publicInputs.publicLabel.value.trim() ? "Unesi javnu oznaku osobe." : "");
    if (!form.checkValidity()) { core.open = true; privacy.open = true; form.reportValidity(); return; }
    const patch = dataPatch();
    if (profileDataIssues({ ...person.data, ...patch }).length) {
      status.textContent = "Provjeri podatke i mjesta života. Unesene promjene su zadržane.";
      return;
    }
    onApply({ data: patch, privacy: { publicAnchor: checkbox.checked,
      ...Object.fromEntries(Object.entries(publicInputs).map(([key, input]) => [key, input.value.trim()])) } },
      { coreOpen: core.open, privacyOpen: privacy.open });
  });
  return controller;
}
