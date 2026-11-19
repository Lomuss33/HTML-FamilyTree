import { FamilyEditError, findPossibleDuplicates } from "./family-edit.js";

export const FAMILY_EDIT_TITLES = { standalone: "Dodaj osobu", parent: "Dodaj roditelja", partner: "Dodaj partnera", sibling: "Dodaj brata/sestru", child: "Dodaj dijete" };

export function createFamilyEditForm({ root, getNodes, personName, findPeople, onApply, onCancel }) {
  let context = null, controls = null;
  function element(tag, text, className) {
    const item = document.createElement(tag);
    if (text !== undefined) item.textContent = text;
    if (className) item.className = className;
    return item;
  }
  function button(text, action, className = "secondary-button") {
    const item = element("button", text, className); item.type = "button"; item.addEventListener("click", action); return item;
  }
  const describe = person => personName(person) + (person.data?.birthday ? " · " + person.data.birthday : "");
  function picker(id, label, exclude, changed) {
    let selectedId = "";
    const container = element("section", undefined, "family-person-picker");
    const field = element("label", undefined, "field"), search = element("input");
    search.type = "search"; search.id = id; search.autocomplete = "off"; search.maxLength = 200;
    search.placeholder = "Ime, prezime, nadimak ili godina";
    field.append(element("span", label), search);
    const selected = element("p", "Osoba nije odabrana.", "family-selected-person"); selected.setAttribute("role", "status");
    const list = element("ul", undefined, "family-person-results");
    function render() {
      list.replaceChildren();
      const nodes = getNodes(), excluded = exclude();
      const matches = findPeople(nodes, search.value).filter(person => !excluded.includes(person.id));
      for (const person of matches.slice(0, 15)) {
        const row = element("li");
        const choice = button(describe(person), () => choose(person.id), "person-link");
        choice.dataset.personId = person.id; choice.setAttribute("aria-pressed", String(person.id === selectedId));
        row.append(choice); list.append(row);
      }
      if (!matches.length) list.append(element("li", "Nema rezultata.", "people-empty"));
      if (matches.length > 15) list.append(element("li", "Prikazano je prvih 15 osoba. Suzi pretragu.", "people-empty"));
    }
    function choose(id) {
      const person = getNodes().find(value => value.id === id);
      if (!person || exclude().includes(id)) return;
      selectedId = id; selected.textContent = "Odabrano: " + describe(person); render(); changed();
    }
    function clear() { selectedId = ""; search.value = ""; selected.textContent = "Osoba nije odabrana."; render(); }
    search.addEventListener("input", () => { selectedId = ""; selected.textContent = "Osoba nije odabrana."; render(); changed(); });
    container.append(field, selected, list); render();
    return { root: container, choose, clear, render, search, value: () => selectedId, hasDraft: () => Boolean(selectedId || search.value.trim()) };
  }
  function clear() { context = null; controls = null; root.replaceChildren(); root.hidden = true; }
  function open({ type, anchorId }) {
    clear(); context = { type, anchorId };
    const anchor = getNodes().find(person => person.id === anchorId);
    const form = element("form", undefined, "family-edit-form"); form.noValidate = true;
    const heading = element("h3", FAMILY_EDIT_TITLES[type]);
    form.append(heading, element("p", anchor ? "Uz osobu: " + describe(anchor) : "Osoba će biti dodana kao nepovezana grana.", "people-empty"),
      element("p", "Promjena prvo ulazi u privatni nacrt. Pregledaj je pa pritisni Save za trajno spremanje.", "people-empty"));
    const modeField = element("label", undefined, "field"), mode = element("select"); mode.id = "family-person-mode";
    mode.append(new Option("Nova osoba", "new"), new Option("Osoba već postoji u stablu", "existing"));
    modeField.append(element("span", "Želiš dodati novu ili povezati postojeću osobu?"), mode); modeField.hidden = type === "standalone";
    form.append(modeField);
    const newFields = element("fieldset", undefined, "family-new-person"); newFields.append(element("legend", "Podaci nove osobe"));
    const inputs = {};
    for (const [key, label, max] of [["first name", "Ime", 200], ["last name", "Prezime", 200], ["birthday", "Rođenje: datum, godina ili približan podatak", 80]]) {
      const field = element("label", undefined, "field"), input = element("input");
      input.type = "text"; input.name = key; input.maxLength = max; input.autocomplete = "off";
      input.addEventListener("input", () => { inputs["first name"].setCustomValidity(""); duplicateAck.checked = false; renderDuplicates(); summary(); });
      inputs[key] = input; field.append(element("span", label), input); newFields.append(field);
    }
    const genderField = element("label", undefined, "field"), gender = element("select"); gender.name = "gender"; gender.required = true;
    gender.append(new Option("Odaberi", ""), new Option("Muški", "M"), new Option("Ženski", "F"));
    genderField.append(element("span", "Spol za prikaz u stablu"), gender); newFields.append(genderField);
    const duplicates = element("section", undefined, "family-duplicate-warning"); duplicates.hidden = true;
    const duplicateList = element("ul", undefined, "family-person-results");
    const duplicateLabel = element("label", undefined, "person-privacy-toggle"), duplicateAck = element("input"); duplicateAck.type = "checkbox"; duplicateAck.id = "family-duplicate-ack";
    duplicateLabel.append(duplicateAck, element("span", "Provjerio/la sam podudaranja i želim dodati novu osobu."));
    duplicates.append(element("strong", "Možda osoba već postoji"), element("p", type === "standalone"
      ? "Ako je to ista osoba, odustani i otvori njezin profil iz pretrage. Inače potvrdi da dodaješ drugu osobu istog imena."
      : "Odaberi postojeći zapis ili potvrdi da se radi o drugoj osobi istog imena."), duplicateList, duplicateLabel);
    const personData = () => ({ ...Object.fromEntries(Object.entries(inputs).map(([key, input]) => [key, input.value])), gender: gender.value });
    function renderDuplicates() {
      const matches = findPossibleDuplicates(getNodes(), personData());
      duplicates.hidden = mode.value !== "new" || !matches.length; duplicateList.replaceChildren();
      for (const person of matches.slice(0, 5)) {
        if (type === "standalone") { const row = element("li", describe(person)); duplicateList.append(row); continue; }
        const row = element("li"), choice = button(describe(person), () => { mode.value = "existing"; primary.choose(person.id); changeMode(); }, "person-link");
        choice.disabled = person.id === anchorId; row.append(choice); duplicateList.append(row);
      }
      if (!matches.length) duplicateAck.checked = false;
    }
    const primary = picker("family-existing-search", "Pronađi postojeću osobu", () => [anchorId], () => {
      if (secondary.value() === primary.value()) secondary.clear();
      secondary.render(); summary();
    });
    primary.root.hidden = true;
    form.append(newFields, duplicates, primary.root);
    const shared = element("fieldset", undefined, "family-shared-parents"), sharedChoices = [];
    if (type === "sibling") {
      shared.append(element("legend", "Koji su roditelji zajednički?"), element("p", "Označi samo roditelje koje ova osoba dijeli s osobom iz otvorenog profila."));
      for (const id of anchor?.rels.parents ?? []) {
        const parent = getNodes().find(person => person.id === id), label = element("label", undefined, "person-privacy-toggle"), checkbox = element("input");
        checkbox.type = "checkbox"; checkbox.value = id; checkbox.name = "shared-parent";
        checkbox.addEventListener("change", summary);
        label.append(checkbox, element("span", describe(parent))); shared.append(label); sharedChoices.push(checkbox);
      }
      form.append(shared);
    }
    const other = element("section", undefined, "family-other-parent"), includeOther = element("input"), otherLabel = element("label", undefined, "person-privacy-toggle");
    includeOther.type = "checkbox"; includeOther.id = "family-include-other-parent";
    otherLabel.append(includeOther, element("span", "Dodaj i drugog roditelja"));
    const secondary = picker("family-other-parent-search", "Pronađi drugog roditelja", () => [anchorId, mode.value === "existing" ? primary.value() : null], summary);
    secondary.root.hidden = true;
    other.append(otherLabel, secondary.root);
    if (type === "child") form.append(other);
    const preview = element("p", "", "family-edit-summary"), status = element("p", "", "status-message");
    preview.setAttribute("role", "status");
    status.id = "family-edit-status"; status.setAttribute("role", "status");
    function summary() {
      const target = mode.value === "new" ? [inputs["first name"].value, inputs["last name"].value].filter(Boolean).join(" ") || "nova osoba"
        : personName(getNodes().find(person => person.id === primary.value()));
      const name = anchor ? personName(anchor) : "";
      const sharedNames = sharedChoices.filter(input => input.checked).map(input => personName(getNodes().find(person => person.id === input.value)));
      preview.textContent = type === "standalone" ? "Nova osoba bit će zasebna grana. Javna vidljivost nije uključena."
        : type === "parent" ? target + " bit će roditelj osobe " + name + "."
          : type === "partner" ? name + " i " + target + " bit će upisani kao partneri."
            : type === "child" ? name + " bit će roditelj osobe " + target + (includeOther.checked && secondary.value()
              ? "; drugi roditelj: " + personName(getNodes().find(person => person.id === secondary.value())) : "") + "."
              : !sharedNames.length ? "Odaberi barem jednog zajedničkog roditelja."
                : target + " i " + name + (sharedNames.length === 1 ? " imat će zajedničkog roditelja: " : " imat će zajedničke roditelje: ") + sharedNames.join(" i ") + ".";
    }
    function changeMode() {
      newFields.hidden = mode.value !== "new"; newFields.disabled = mode.value !== "new";
      if (mode.value === "existing" && secondary.value() && secondary.value() === primary.value()) secondary.clear();
      secondary.render();
      primary.root.hidden = mode.value !== "existing"; renderDuplicates(); summary();
    }
    mode.addEventListener("change", changeMode);
    includeOther.addEventListener("change", () => { secondary.root.hidden = !includeOther.checked; summary(); });
    const actions = element("div", undefined, "family-edit-actions"), submit = element("button", "Dodaj u nacrt", "primary-button"); submit.type = "submit";
    actions.append(button("Odustani", onCancel), submit); form.append(preview, status, actions);
    form.addEventListener("submit", event => {
      event.preventDefault(); if (submit.disabled) return;
      if (mode.value === "new") inputs["first name"].setCustomValidity(!inputs["first name"].value.trim() && !inputs["last name"].value.trim() ? "Upiši barem ime ili prezime." : "");
      if (!form.reportValidity()) return;
      if (mode.value === "existing" && !primary.value()) { status.textContent = "Odaberi postojeću osobu iz rezultata pretrage."; return; }
      if (type === "child" && includeOther.checked && !secondary.value()) { status.textContent = "Odaberi drugog roditelja ili isključi taj odabir."; return; }
      const request = { type, ...(type !== "standalone" ? { anchorId } : {}),
        ...(mode.value === "new" ? { newPerson: personData(), allowDuplicate: duplicateAck.checked } : { personId: primary.value() }),
        ...(type === "sibling" ? { sharedParentIds: sharedChoices.filter(input => input.checked).map(input => input.value) } : {}),
        ...(type === "child" && includeOther.checked ? { otherParentId: secondary.value() } : {}) };
      submit.disabled = true; status.textContent = ""; status.classList.remove("is-error");
      try { onApply(request); }
      catch (error) { status.textContent = error instanceof FamilyEditError ? error.message : "Promjenu nije moguće pripremiti. Uneseni podaci su zadržani."; status.classList.add("is-error"); }
      finally { submit.disabled = false; }
    });
    root.append(form); root.hidden = false;
    controls = { inputs, gender, primary, secondary, includeOther, sharedChoices, duplicateAck, mode };
    changeMode();
  }
  return {
    open, clear,
    active: () => Boolean(context),
    title: () => FAMILY_EDIT_TITLES[context?.type] ?? "Dodaj osobu",
    anchorId: () => context?.anchorId,
    hasDraft: () => Boolean(controls && (Object.values(controls.inputs).some(input => input.value) || controls.gender.value
      || controls.primary.hasDraft() || controls.secondary.hasDraft() || controls.includeOther.checked
      || controls.sharedChoices.some(input => input.checked) || controls.duplicateAck.checked)),
    focus() { (controls?.mode.value === "existing" ? controls.primary.search : controls?.inputs["first name"])?.focus(); }
  };
}
