import { PROFILE_CHANGE_FIELDS, validateProfileChange } from "./profile-change.js";

export function createProfileChangeForm(root) {
  let target = null;
  const controls = new Map();
  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }
  function clear() { target = null; controls.clear(); root.replaceChildren(); root.hidden = true; root.disabled = false; }
  function open(anchor, catalogVersion) {
    clear(); target = { personId: anchor.id, catalogVersion }; root.hidden = false;
    root.append(element("legend", "Ispravak podataka: " + anchor.displayLabel),
      element("p", "Označi samo podatke koje želiš predložiti. Privatni podaci nisu prikazani. Bilješke i mjesta života dodaju se postojećim zapisima; ostali odabrani podaci predlažu zamjenu."));
    for (const field of PROFILE_CHANGE_FIELDS) {
      const group = element("div", undefined, "profile-change-field");
      const label = element("label", undefined, "profile-change-toggle");
      const checked = element("input"); checked.type = "checkbox"; checked.dataset.profileField = field.key;
      label.append(checked, element("span", field.label)); group.append(label);
      const content = element("div", undefined, "profile-change-input");
      let input;
      if (field.key === "residences") {
        const rows = element("div");
        const add = element("button", "Dodaj još jedno mjesto života", "secondary-button"); add.type = "button";
        function addRow() {
          if (rows.children.length >= 12) return;
          const row = element("div", undefined, "profile-change-residence");
          for (const [key, title, max] of [["place", "Mjesto", 200], ["from", "Od", 80], ["to", "Do", 80]]) {
            const item = element("label", undefined, "field"); const control = element("input");
            control.type = "text"; control.dataset.residence = key; control.maxLength = max; control.required = key === "place";
            item.append(element("span", title), control); row.append(item);
          }
          const remove = element("button", "Ukloni mjesto", "secondary-button"); remove.type = "button";
          remove.addEventListener("click", () => row.remove()); row.append(remove); rows.append(row);
        }
        add.addEventListener("click", addRow); addRow(); content.append(rows, add);
        input = () => [...rows.children].map(row => Object.fromEntries([...row.querySelectorAll("input")].map(control => [control.dataset.residence, control.value])));
      } else {
        const control = element(field.multiline ? "textarea" : "input");
        if (!field.multiline) control.type = "text";
        control.maxLength = field.maxLength; control.required = true; control.setAttribute("aria-label", field.label);
        control.dataset.proposedField = field.key; content.append(control);
        input = () => control.value;
      }
      function toggle() { content.hidden = !checked.checked; for (const control of content.querySelectorAll("input,textarea,button")) control.disabled = !checked.checked; }
      checked.addEventListener("change", toggle); toggle(); group.append(content); root.append(group);
      controls.set(field.key, { checked, input });
    }
  }
  return {
    open, clear,
    active: () => Boolean(target),
    hasDraft: () => Boolean(target) && [...controls.values()].some(value => value.checked.checked),
    setBusy(value) { root.disabled = value; },
    refreshCatalog(catalog) {
      if (!target) return;
      const anchor = catalog.anchors.find(value => value.id === target.personId);
      if (!anchor) throw new Error("Osoba više nije javno prikazana. Uneseni prijedlog je zadržan, ali ga nije moguće poslati kroz ovaj profil.");
      target.catalogVersion = catalog.catalogVersion;
      root.querySelector("legend").textContent = "Ispravak podataka: " + anchor.displayLabel;
    },
    value() {
      if (!target) return null;
      return validateProfileChange({ ...target, changes: Object.fromEntries([...controls].filter(([, value]) => value.checked.checked).map(([key, value]) => [key, value.input()])) });
    }
  };
}
