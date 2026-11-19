import { PROFILE_FIELDS, profileAliases } from "./profile-data.js";
import { createProfileEditor } from "./profile-editor.js";
import { createFamilyEditForm, FAMILY_EDIT_TITLES } from "../editor/family-edit-form.js";
import { findRelationshipPath, relationshipPathLabel, RELATIONSHIP_LABELS } from "./relationship-path.js";

const collator = new Intl.Collator("hr", { sensitivity: "base", numeric: true });
const fold = value => String(value ?? "").normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("hr").replaceAll("đ", "d");

export function personName(person) {
  return [person?.data?.["first name"], person?.data?.["last name"]].filter(Boolean).join(" ") || "Osoba bez imena";
}

export function personDateLabel(person) {
  if (person?.publicView) return person.data?.publicLifespan ? "Javne godine: " + person.data.publicLifespan : "Godine nisu javno navedene.";
  return person?.data?.birthday ? "Rođenje: " + person.data.birthday : "Rođenje nije upisano.";
}

export function findPeople(nodes, query = "") {
  const terms = fold(query).split(/[\s,]+/).filter(Boolean);
  return nodes.filter(person => {
    const text = fold(personName(person) + " " + (person.publicView
      ? [person.data?.publicLifespan, person.data?.publicBranch].filter(Boolean).join(" ")
      : [person.data?.birthday, profileAliases(person.data)].filter(Boolean).join(" ")));
    return terms.every(term => text.includes(term));
  }).sort((left, right) => collator.compare(personName(left), personName(right))
    || collator.compare(left.data?.birthday ?? "", right.data?.birthday ?? ""));
}

// The browser uses only the already unlocked session. No index, search term or
// person details are persisted, placed in URLs, or sent to another service.
export function createPersonBrowser({ root, onShowInTree, onUpdatePerson, onFamilyEdit, onSuggestPersonChange, onProfileViewChange, photos }) {
  const get = selector => root.querySelector(selector);
  const search = get("#people-search");
  const results = get("#people-results");
  const count = get("#people-count");
  const detail = get("#person-detail");
  const back = get("#people-back");
  const title = get("#people-title");
  const referenceLabel = get("#relationship-reference-label");
  const clearReference = get("#relationship-clear-reference");
  let nodes = [];
  let byId = new Map();
  let selectedId = null;
  let referenceId = null;
  let canEditPrivacy = false;
  let activeEditor = null;
  let renderedPerson = null;
  let suggestionSupport = false;
  const addPerson = get("#people-add");
  const familyEditor = createFamilyEditForm({ root: get("#family-edit-panel"), getNodes: () => nodes, personName, findPeople,
    onCancel: cancelFamilyEdit,
    onApply(request) {
      const result = onFamilyEdit(request);
      familyEditor.clear();
      select(result.personId);
      const notice = element("p", "Promjena je u nacrtu. Pregledaj je pa pritisni Save za trajno spremanje.", "status-message");
      notice.id = "family-edit-result"; notice.setAttribute("role", "status");
      get("#person-detail-name").after(notice);
    }
  });

  function showView(view) {
    root.dataset.view = view;
    back.hidden = view === "search";
    back.textContent = view === "family" && familyEditor.anchorId() ? "← Profil" : "← Pretraga";
    title.textContent = view === "family" ? familyEditor.title() : view === "profile" ? "Profil osobe" : "Osobe i obitelj";
    onProfileViewChange?.(view === "profile" && root.open ? selectedId : null);
  }
  showView("search");

  function hasDraft() {
    return Boolean(activeEditor?.hasDraft() || familyEditor.hasDraft());
  }

  function mayLeave() {
    if (!hasDraft()) return true;
    if (!confirm("Odbaciti neprimijenjene promjene podataka osobe?")) return false;
    activeEditor?.reset(); familyEditor.clear();
    return true;
  }

  function startFamilyEdit(type, anchorId) {
    if (!canEditPrivacy || !onFamilyEdit || !mayLeave()) return;
    familyEditor.open({ type, anchorId });
    showView("family"); familyEditor.focus();
  }

  function cancelFamilyEdit() {
    const anchorId = familyEditor.anchorId();
    if (!mayLeave()) return;
    familyEditor.clear();
    if (anchorId && byId.has(anchorId)) select(anchorId);
    else { showView("search"); renderResults(); search.focus(); }
  }

  function element(tag, text, className) {
    const node = document.createElement(tag);
    if (text !== undefined) node.textContent = text;
    if (className) node.className = className;
    return node;
  }

  function personButton(person) {
    const button = element("button", undefined, "person-link");
    button.type = "button";
    button.append(element("strong", personName(person)),
      element("span", personDateLabel(person)));
    button.addEventListener("click", () => select(person.id));
    return button;
  }

  function renderResults() {
    const matches = findPeople(nodes, search.value);
    const visible = matches.slice(0, 50);
    count.textContent = matches.length > visible.length
      ? "Prikazano " + visible.length + " od " + matches.length + " osoba. Suzi pretragu imenom, prezimenom ili godinom."
      : "Pronađeno osoba: " + matches.length;
    results.replaceChildren();
    for (const person of visible) {
      const item = element("li");
      const button = personButton(person);
      button.setAttribute("aria-pressed", String(person.id === selectedId));
      item.append(button);
      results.append(item);
    }
    if (!matches.length) results.append(element("li", "Nema rezultata. Pokušaj s dijelom imena ili prezimena.", "people-empty"));
  }

  function renderReference() {
    const person = byId.get(referenceId);
    referenceLabel.textContent = person ? "Početna osoba: " + personName(person) : "Početna osoba nije odabrana.";
    clearReference.hidden = !person;
  }

  function renderRelationship() {
    const section = get("#person-relationship");
    const person = byId.get(selectedId);
    if (!section || !person) return;
    section.replaceChildren(element("h4", "Kako smo rodbina"));
    const choose = element("button", referenceId === selectedId ? "Ovo je početna osoba" : "Postavi kao početnu osobu", "secondary-button");
    choose.id = "relationship-set-reference";
    choose.type = "button";
    choose.disabled = referenceId === selectedId;
    choose.addEventListener("click", () => { referenceId = selectedId; renderReference(); renderRelationship(); });
    section.append(choose);
    if (!referenceId) {
      section.append(element("p", "Odaberi sebe ili drugu početnu osobu, a zatim otvori profil osobe s kojom želiš vidjeti vezu.", "people-empty"));
      return;
    }
    const path = findRelationshipPath(nodes, referenceId, selectedId);
    if (!path) {
      section.append(element("p", person.publicView
        ? "U javno prikazanim podacima nije pronađena veza s početnom osobom."
        : "U upisanim podacima nije pronađena veza s početnom osobom.", "relationship-status"));
      return;
    }
    section.append(element("p", relationshipPathLabel(path), "relationship-status"));
    if (path.length === 1) return;
    section.append(element("p", person.publicView ? "Jedan najkraći put kroz javno prikazane veze:" : "Jedan najkraći put kroz upisane veze:", "people-empty"));
    const list = element("ol", undefined, "relationship-path");
    for (const step of path) {
      const item = element("li");
      item.append(element("span", step.relation ? "↓ " + RELATIONSHIP_LABELS[step.relation] : "Početna osoba", "relationship-step"), personButton(byId.get(step.id)));
      list.append(item);
    }
    section.append(list);
  }

  function renderDetail() {
    detail.replaceChildren();
    activeEditor = null;
    const person = byId.get(selectedId);
    renderedPerson = person;
    if (!person) {
      detail.append(element("p", "Odaberi osobu za pregled podataka i upisanih članova obitelji.", "people-empty"));
      return;
    }
    const heading = element("h3", personName(person));
    heading.id = "person-detail-name";
    heading.tabIndex = -1;
    detail.append(heading,
      element("p", personDateLabel(person), "person-birth"));
    const relationship = element("section", undefined, "person-relationship");
    relationship.id = "person-relationship";
    relationship.setAttribute("aria-label", "Kako smo rodbina");
    detail.append(relationship);
    renderRelationship();
    if (!person.publicView && person.data?.avatar?.startsWith("media:")) {
      const image = element("img", undefined, "person-portrait");
      image.alt = "Glavna fotografija: " + personName(person);
      detail.prepend(image);
      void photos.preview(person.data.avatar.slice(6)).then(url => { if (image.isConnected) image.src = url; }, () => image.remove());
    }
    if (person.publicView && person.data?.publicBranch) detail.append(element("p", person.data.publicBranch));
    if (!person.publicView) {
      const facts = element("dl", undefined, "person-facts");
      for (const { key, label } of PROFILE_FIELDS.filter(field => !["first name", "last name", "birthday"].includes(field.key))) {
        if (!person.data?.[key]) continue;
        facts.append(element("dt", label), element("dd", person.data[key]));
      }
      for (const entry of person.data?.residences ?? []) {
        facts.append(element("dt", "Mjesto života"), element("dd", entry.place + " · " + (entry.from || "?") + " — " + (entry.to || "?")));
      }
      detail.append(facts);
      if (person.data?.gallery?.length) {
        const section = element("section", undefined, "person-gallery");
        section.append(element("h4", "Fotografije"));
        for (const photo of person.data.gallery) {
          const button = element("button", undefined, "photo-tile"); button.type = "button";
          button.setAttribute("aria-label", "Otvori fotografiju: " + photo.name);
          const image = element("img"); image.alt = photo.caption || photo.name;
          void photos.preview(photo.id).then(url => { if (image.isConnected) image.src = url; }, () => { image.alt = "Fotografija nije dostupna u ovom pristupu."; });
          button.append(image, element("span", photo.caption || photo.name));
          button.addEventListener("click", () => void photos.show(photo).catch(() => { button.title = "Fotografija trenutačno nije dostupna."; }));
          section.append(button);
        }
        detail.append(section);
      }
    }
    const show = element("button", "Pokaži u stablu", "primary-button");
    show.type = "button";
    show.addEventListener("click", () => {
      if (!mayLeave()) return;
      if (onShowInTree(person.id) !== false) root.close();
      else {
        status.textContent = "Dovrši otvorenu karticu ili pričekaj završetak spremanja pa pokušaj ponovno. Podaci su zadržani.";
      }
    });
    const status = element("p", "", "status-message");
    status.setAttribute("role", "status");
    detail.append(show, status);
    if (canEditPrivacy && !person.publicView && onFamilyEdit) {
      const actions = element("section", undefined, "family-add-actions");
      actions.setAttribute("aria-label", "Dodaj ili poveži člana obitelji");
      actions.append(element("h4", "Dodaj ili poveži"));
      for (const type of ["parent", "partner", "sibling", "child"]) {
        const action = element("button", FAMILY_EDIT_TITLES[type], "secondary-button"); action.type = "button";
        action.disabled = type === "parent" ? person.rels.parents.length >= 2 : type === "sibling" && !person.rels.parents.length;
        action.addEventListener("click", () => startFamilyEdit(type, person.id)); actions.append(action);
      }
      if (!person.rels.parents.length) actions.append(element("p", "Za povezivanje braće/sestara najprije dodaj barem jednog zajedničkog roditelja.", "people-empty"));
      detail.append(actions);
    }
    if (person.publicView && onSuggestPersonChange) {
      const suggest = element("button", "Predloži ispravak", "secondary-button");
      suggest.id = "person-suggest-change"; suggest.type = "button"; suggest.hidden = !suggestionSupport;
      suggest.addEventListener("click", () => { if (mayLeave()) onSuggestPersonChange(person.id); });
      detail.append(suggest);
    }
    const parents = new Set(person.rels?.parents ?? []);
    const siblings = parents.size ? nodes.filter(other => other.id !== person.id && other.rels?.parents?.some(id => parents.has(id))) : [];
    for (const [key, label] of [["parents", "Roditelji"], ["siblings", "Braća i sestre"], ["spouses", "Partneri"], ["children", "Djeca"]]) {
      const section = element("section", undefined, "person-relatives");
      section.setAttribute("aria-label", label);
      section.append(element("h4", label));
      const relatives = key === "siblings" ? siblings : (person.rels?.[key] ?? []).map(id => byId.get(id)).filter(Boolean);
      if (!relatives.length) section.append(element("p", person.publicView ? "Nema javno prikazanih veza." : "Nema upisanih podataka.", "people-empty"));
      else {
        const list = element("ul");
        for (const relative of relatives) {
          const item = element("li");
          item.append(personButton(relative));
          list.append(item);
        }
        section.append(list);
      }
      detail.append(section);
    }
    if (canEditPrivacy && !person.publicView && onUpdatePerson) renderEditor(person);
  }

  function renderEditor(person) {
    const editor = createProfileEditor(person, (changes, ui) => {
      const applied = onUpdatePerson(person.id, changes) !== false;
      const core = get(".person-edit");
      const privacy = get(".person-privacy");
      if (core) core.open = ui.coreOpen;
      if (privacy) privacy.open = ui.privacyOpen;
      const status = get("#person-privacy-status");
      if (status) status.textContent = applied
        ? "Postavke su u nacrtu. Zatvori ovaj pregled i klikni Save za pregled javnih promjena i spremanje."
        : "Dovrši otvorenu karticu ili pričekaj završetak spremanja. Unesene promjene su zadržane.";
    }, photos);
    activeEditor = editor;
    detail.append(editor.form);
  }

  function select(id) {
    if (!byId.has(id)) return;
    const changed = id !== selectedId;
    if (changed && !mayLeave()) {
      showView("profile");
      get("#person-detail-name")?.focus({ preventScroll: true });
      return;
    }
    selectedId = id;
    renderResults();
    if (changed || renderedPerson !== byId.get(id) || !get("#person-detail-name")) {
      renderDetail();
      detail.scrollTop = 0;
    }
    showView("profile");
    get("#person-detail-name").focus({ preventScroll: true });
  }

  search.addEventListener("input", renderResults);
  back.addEventListener("click", () => {
    if (familyEditor.active()) cancelFamilyEdit();
    else { showView("search"); search.focus(); }
  });
  addPerson.addEventListener("click", () => startFamilyEdit("standalone"));
  clearReference.addEventListener("click", () => { referenceId = null; renderReference(); renderRelationship(); });
  get("#people-close").addEventListener("click", () => { if (mayLeave()) root.close(); });
  root.addEventListener("cancel", event => { if (!mayLeave()) event.preventDefault(); });
  root.addEventListener("close", () => { familyEditor.clear(); onProfileViewChange?.(null); });

  return {
    hasDraft,
    setSuggestionSupport(enabled) {
      suggestionSupport = enabled === true;
      const button = get("#person-suggest-change");
      if (button) button.hidden = !suggestionSupport;
    },
    setNodes(value, options = {}) {
      if (Object.hasOwn(options, "canEditPrivacy")) canEditPrivacy = options.canEditPrivacy;
      addPerson.hidden = !canEditPrivacy || !onFamilyEdit;
      nodes = value;
      byId = new Map(nodes.map(person => [person.id, person]));
      if (!byId.has(selectedId)) { selectedId = null; showView("search"); }
      if (!byId.has(referenceId)) referenceId = null;
      renderReference();
      if (root.open) { renderResults(); if (!familyEditor.active()) renderDetail(); }
    },
    open(id) {
      search.value = "";
      if (!root.open) root.showModal();
      if (id && byId.has(id)) select(id);
      else {
        renderResults();
        if (renderedPerson !== byId.get(selectedId) || !get("#person-detail-name")) renderDetail();
        showView("search"); search.focus();
      }
    },
    clear() {
      activeEditor?.dispose();
      familyEditor.clear(); addPerson.hidden = true;
      if (root.open) root.close();
      nodes = [];
      byId.clear();
      selectedId = null;
      referenceId = null;
      canEditPrivacy = false;
      activeEditor = null;
      renderedPerson = null;
      search.value = "";
      results.replaceChildren();
      detail.replaceChildren();
      count.textContent = "";
      showView("search");
      renderReference();
    }
  };
}
