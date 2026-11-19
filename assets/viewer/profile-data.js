import { galleryIssues } from "./media-data.js";
export const PROFILE_FIELDS = Object.freeze([
  { key: "first name", label: "Ime" },
  { key: "last name", label: "Prezime" },
  { key: "birthday", label: "Datum rođenja", hint: "Možeš upisati datum, samo godinu ili približan podatak." },
  { key: "maiden name", label: "Djevojačko prezime" },
  { key: "previous names", label: "Prijašnja imena i prezimena", multiline: true, hint: "Više zapisa možeš odvojiti novim retkom." },
  { key: "nicknames", label: "Nadimci", hint: "Upiši jedan ili više nadimaka po kojima je osoba poznata." },
  { key: "birthplace", label: "Mjesto rođenja" },
  { key: "notes", label: "Dodatne bilješke", multiline: true, hint: "Izvori, zanimanja, priče i ostali podaci koje želiš sačuvati." }
]);

export function profileDataIssues(data) {
  const issues = [];
  for (const { key } of PROFILE_FIELDS) {
    if (Object.hasOwn(data, key) && typeof data[key] !== "string") issues.push("Profile text fields must be strings.");
  }
  if (Object.hasOwn(data, "residences")) {
    if (!Array.isArray(data.residences)) issues.push("Residence history must be a list.");
    else for (const entry of data.residences) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)
        || Object.keys(entry).sort().join() !== "from,place,to"
        || ![entry.place, entry.from, entry.to].every(value => typeof value === "string")
        || !entry.place.trim()) issues.push("Each residence needs a place and text values for its period.");
    }
  }
  return [...issues, ...galleryIssues(data)];
}

export function profileAliases(data) {
  return [data?.["maiden name"], data?.["previous names"], data?.nicknames].filter(value => typeof value === "string").join(" ");
}
