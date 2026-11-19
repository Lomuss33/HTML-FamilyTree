import { PROFILE_FIELDS } from "../viewer/profile-data.js";

const limits = { "first name": 200, "last name": 200, birthday: 80, "maiden name": 200,
  "previous names": 2000, nicknames: 500, birthplace: 500, notes: 2000 };
export const PROFILE_CHANGE_FIELDS = Object.freeze([
  ...PROFILE_FIELDS.map(field => ({ ...field, label: field.key === "notes" ? "Dopuna bilješki" : field.label, maxLength: limits[field.key] })),
  { key: "residences", label: "Dodaj mjesta života" }
]);
const keys = new Set(PROFILE_CHANGE_FIELDS.map(field => field.key));
const revision = /^sha256:[a-f0-9]{64}$/;
const plain = value => value && typeof value === "object" && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

export class ProfileChangeError extends Error {
  constructor(message = "Prijedlog ispravka nije valjan.", statusCode = 400) {
    super(message); this.name = "ProfileChangeError"; this.statusCode = statusCode; this.category = "profile_change";
  }
}
export function validateProfileChange(value, allowlist) {
  if (!plain(value) || Object.keys(value).sort().join() !== "catalogVersion,changes,personId"
    || typeof value.personId !== "string" || !value.personId.trim() || value.personId.length > 200
    || typeof value.catalogVersion !== "string" || !revision.test(value.catalogVersion) || !plain(value.changes)) throw new ProfileChangeError();
  if (allowlist) {
    if (value.catalogVersion !== allowlist.catalogVersion) throw new ProfileChangeError("Javni popis osoba promijenjen je. Ponovno pošalji prijedlog kako bi se osvježio.", 409);
    if (!allowlist.anchorIds.includes(value.personId)) throw new ProfileChangeError();
  }
  const fields = Object.keys(value.changes);
  if (!fields.length || fields.some(key => !keys.has(key))) throw new ProfileChangeError("Odaberi barem jedno polje koje želiš dopuniti ili ispraviti.");
  const changes = {};
  for (const key of fields) {
    const input = value.changes[key];
    if (key === "residences") {
      if (!Array.isArray(input) || !input.length || input.length > 12) throw new ProfileChangeError("Dodaj od jednog do dvanaest zapisa o mjestu života.");
      const seen = new Set();
      changes.residences = input.map(entry => {
        if (!plain(entry) || Object.keys(entry).sort().join() !== "from,place,to"
          || ![entry.place, entry.from, entry.to].every(text => typeof text === "string" && !text.includes("\0"))
          || !entry.place.trim() || entry.place.length > 200 || entry.from.length > 80 || entry.to.length > 80) throw new ProfileChangeError("Provjeri mjesto života i pripadajuće razdoblje.");
        const fingerprint = JSON.stringify([entry.place, entry.from, entry.to]);
        if (seen.has(fingerprint)) throw new ProfileChangeError("Isti zapis o mjestu života naveden je više puta.");
        seen.add(fingerprint);
        return { place: entry.place, from: entry.from, to: entry.to };
      });
    } else {
      if (typeof input !== "string" || !input.trim() || input.length > limits[key] || input.includes("\0")) throw new ProfileChangeError("Provjeri označena polja. Za brisanje podatka pošalji napomenu vlasniku.");
      changes[key] = input;
    }
  }
  return { personId: value.personId, catalogVersion: value.catalogVersion, changes };
}

export function validateProfileSelection(change, selected) {
  if (!Array.isArray(selected) || !selected.length || selected.some(key => typeof key !== "string" || !Object.hasOwn(change.changes, key))
    || new Set(selected).size !== selected.length) throw new ProfileChangeError("Odaberi barem jedno predloženo polje za prihvaćanje.");
  return [...selected];
}

export function applyProfileChange(nodes, input, selected) {
  const change = validateProfileChange(input);
  const fields = validateProfileSelection(change, selected);
  const result = structuredClone(nodes);
  const person = result.find(value => value.id === change.personId);
  if (!person) throw new ProfileChangeError("Osoba više nije u trenutnom stablu. Provjeri prijedlog.", 409);
  for (const key of fields) {
    const value = change.changes[key];
    if (key === "notes") {
      const existing = person.data.notes ?? "";
      if (existing !== value && !existing.endsWith("\n\n" + value)) person.data.notes = existing ? existing + "\n\n" + value : value;
    } else if (key === "residences") {
      const existing = person.data.residences ?? [];
      person.data.residences = [...existing];
      for (const entry of value) if (!person.data.residences.some(previous => previous.place === entry.place && previous.from === entry.from && previous.to === entry.to)) person.data.residences.push({ ...entry });
    } else person.data[key] = value;
  }
  return result;
}

export function profileFieldText(value) {
  if (Array.isArray(value)) return value.map(entry => entry.place + " · " + (entry.from || "?") + " — " + (entry.to || "?")).join("\n") || "Nije upisano.";
  return typeof value === "string" && value ? value : "Nije upisano.";
}
