# Personal Family Archive

A small personal family tree: visitors can browse explicitly approved public
labels without a password. The owner unlocks the private tree with the existing
family password; the protected local application supports editing the canonical
source. Optional guest suggestions wait for administrator review.

The public landing page and **Pregledaj javno stablo** read only
`data/family.anchors.public.json`. They show reviewed labels, lifespan labels and
branch labels. Preparing a save includes existing direct parent/child and
partner links only when both endpoints are public. Private people, their fields
and paths through them remain excluded. Local suggestion review uses the owner's
family password. The existing AWS review service retains its separate Cognito
authorization; unlocking locally does not sign into or change that service.

Početni zaslon ima kratak uvod i glavni gumb **Pregledaj javno stablo**. Zadržana
je prethodna topla paleta, zelene akcije, tamnozelena podloga stabla i pastelne
kartice, uz očuvanje izvornih boja fotografija.
**Pronađi javnu osobu** otvara pretragu; odabir rezultata odmah otvara javni
profil te osobe. **Administratorski pristup** otvara postojeći obrazac za
obiteljsku lozinku. Oba su odjeljka zatvorena pri prvom dolasku i nakon Locka.

The public/mobile commercial product remains a separate future project. This
edition has no billing, public accounts, or automatic cross-family merges.

Pripremljen je zaseban homelab način (`npm run homelab`): javni pregled i
prijedlozi imaju odvojen ulaz od privatne administracije i Savea preko Tailscalea.
Konfiguracija, prijenos podataka i provjere pristupa opisani su u
[uputama za homelab](docs/homelab.md). Priprema ne objavljuje aplikaciju i ne
mijenja postojeći lokalni postupak ili GitHub Pages.

## Continue with the repaired tree

The chosen local source has been preserved in ignored `private/family.json`.
Missing relationship arrays were repaired and the existing 15 public labels were
reconciled exactly. A migrated checkout can require a password-backed Save to
prepare its encrypted payload and public links; building never performs that
preparation on its own.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:4173, unlock, and click **Save** to prepare the repaired
encrypted edition. Edit cards locally and use the page-level Save once for the
whole draft, including unfinished fields in the current card. Save updates the private source, encrypted payload, public catalog,
backend allowlist, and backend revision together.

Unlocking keeps readable family data in memory. Refresh and Lock close that
session. A failed save keeps the draft. A stale tab cannot overwrite a newer
save; download the private draft before reloading if you need to keep its edits.

After unlocking, **Pronađi osobu** searches all people, including disconnected
branches, by name or recorded birth date/year. Croatian names can also be typed
without diacritics. A person's profile shows the recorded birth information and
links to their parents, partners and children. **Pokaži u stablu** focuses that
person's branch. Tree cards also open the profile outside edit mode. Search and
profiles stay in the unlocked tab's memory and are cleared on Lock or reload.

Na mobitelu se profil otvara kao donja kartica. U običnom pregledu odabrana se
osoba prikazuje u stablu iznad kartice. **← Pretraga** vraća popis i čuva
neprimijenjena polja; ponovni odabir iste osobe vraća ih bez gubitka. Prelazak
na drugu osobu i zatvaranje profila traže potvrdu ako postoje neprimijenjene
promjene. **Pokaži u stablu** zatvara karticu i vraća cijeli prikaz grane.
Na računalu ostaje usporedni prikaz popisa i profila.

Stablo oko odabrane osobe prikazuje **najbližu obitelj**: roditelje, partnere,
braću/sestre prema barem jednom zajedničkom upisanom roditelju i djecu. Profil
prikazuje i popis braće i sestara. Odabirom rođaka otvaraš njegov dio obitelji;
pretraga i dalje pronalazi udaljene i nepovezane osobe. Ograničenje je samo
vizualno: uređivanje i Save zadržavaju sve osobe i veze, uključujući grane koje
trenutačno nisu prikazane. Javni prikaz koristi samo odobrene javne podatke i
ne povezuje braću/sestre preko privatnog roditelja.

Za dodavanje ili povezivanje otvori privatni profil i odaberi **Dodaj roditelja**,
**Dodaj partnera**, **Dodaj brata/sestru** ili **Dodaj dijete**. U obrascu biraš
novu osobu ili pretražuješ postojeće zapise. Za nepovezanu osobu ili novu granu
otvori **Pronađi osobu → Dodaj osobu**. Dovoljno je upisati ime ili prezime i
odabrati spol za postojeći prikaz kartice; podatak o rođenju nije obvezan.

**Dodaj u nacrt** priprema promjenu i otvara profil dodane/povezane osobe.
Zatvori profil i pritisni **Save** za trajno spremanje cijelog stabla.
Nove osobe su privatne. Ista imena pokreću upozorenje: odaberi postojeći zapis
ili izričito potvrdi da dodaješ drugu osobu istog imena. Zapisi se ne spajaju
automatski. Za brata/sestru biraš zajedničke, već upisane roditelje; ako nisu
poznati, najprije dodaj poznatog zajedničkog roditelja. Kod djeteta drugi
roditelj ostaje neodabran dok ga sam ne označiš i pronađeš u pretrazi.
Sažetak odmah prikazuje imena označenih zajedničkih roditelja. Prelazak između
nove i postojeće osobe čuva upisana polja i osvježava izbor drugog roditelja;
ako bi ista osoba bila i dijete i njegov roditelj, taj se nevaljani odabir uklanja.
Nevaljana veza zadržava obrazac bez djelomične promjene stabla. **Odustani**
vraća profil/pretragu uz potvrdu odbacivanja unosa, a **Discard** vraća cijelo
stablo na posljednje spremljeno stanje. Neuspjeli Save zadržava dodane osobe
i veze za ponovni pokušaj.

In a person's profile, **Postavi kao početnu osobu** chooses yourself or another
reference person. Open a second profile to see **Kako smo rodbina**: one shortest
recorded path through parents, children and spouses/partners, with a clickable
profile at every step. Direct relationships, ancestors, descendants and shared
ancestors receive a short explanation. More complex paths show their individual
links without guessing a kinship title or treating co-parents as partners.

The public viewer searches only its approved public graph and cannot cross a
private intermediary. No path means no connection was found in the displayed
records. Reference selection stays in this tab's memory and clears on Lock or
reload; it changes no family data or privacy settings. **Ukloni početnu osobu**
clears the comparison. Selecting or clearing it preserves unfinished profile fields.

In the private local session, a person's profile has **Javna vidljivost**.
Choose whether the person is public and enter the exact public label and any
optional public year/lifespan or branch label. **Primijeni u nacrt** changes only
the draft. Close the profile and use **Save** to review the public label/link
changes and commit the same five files together. Cancelling review keeps the
draft; Discard restores the saved privacy settings. Marking someone private
removes them and all their incident links from the next public edition without
deleting any canonical person or relationship.

Legacy public catalogs without a `relationships` field keep working and are
never rewritten by a build. Unlock locally and Save to prepare the reviewed
public links. `catalogVersion` still identifies approved labels; `sourceRevision`
continues to identify topology. Existing backend contracts remain unchanged.

### Guest suggestions and local review

Only people given a separate submission code can send text or visual suggestions.
After unlocking locally, open **Review** → **Kod za slanje prijedloga** to set or
replace that code (8–200 characters, different from the family password). The code
is entered in the app, never in chat or a command. Its digest is stored privately;
the original code and family password are not saved in suggestion records or logs.
**Isključi slanje prijedloga** stops new submissions and preserves the queue.

Guests use **Pošalji dopunu ili ispravak** without unlocking private data. Submissions stay
pending under ignored `private/suggestions/`. The owner unlocks and opens **Review**
to filter, inspect, accept or reject them. Conflicting review tabs must reload the
record. **Odobri i dodaj u nacrt** validates a visual proposal against the full
current tree, records approval and adds the result to the private in-memory draft.
Close Review, inspect its people and links, then use **Save** to commit the five
family artifacts. New people start private. The approval alone does not change
those files or publish information. Free-form text corrections are entered through the
existing editor and saved normally.

U lokalnom javnom profilu **Predloži ispravak** otvara prazna polja za osobu,
bez otkrivanja privatnih podataka. Posjetitelj s kodom označava predložene
izmjene. Vlasnik u **Review** uspoređuje sadašnje i predložene vrijednosti te
bira polja za **Odobri i dodaj u nacrt**. Bilješke i mjesta života dodaju se
postojećim zapisima. Zasebni **Save** sprema nacrt; javna vidljivost ostaje
nepromijenjena. Nakon spremanja nove inačice stabla staro odobrenje treba
vratiti na čekanje i ponovno pregledati prije ponovnog dodavanja.

Discard, Lock and reload can discard an unsaved addition while keeping its
approval. Open the accepted proposal and use **Dodaj u nacrt** to prepare it again.
Save or discard other edits first; a newer saved tree requires a fresh unlock.
Failed Save keeps the addition in the draft. If approval's response is interrupted,
reload the accepted list before adding it again. Patch download remains an explicit
export option; the existing static AWS review still uses its patch-download flow.
See [review instructions](docs/admin-review.md).

The local service uses the existing validation and public anchor allowlist without
calling AWS. Guest writes require the exact application origin, JSON, a valid code,
and use the per-request limits described below; attempts are limited to 30 per minute per client address.
Owner operations additionally require the local CSRF token and family password.
Settings and review replacements retain verified previous bytes in
`private/suggestions/history/`. Failed writes leave the previous record intact;
reload it before retrying an uncertain review response. Include the whole private
suggestions directory in private machine backups and a future homelab migration;
tree-only backup/restore commands do not include the queue. Queue records and their
history are private plaintext files and are not automatically deleted.

### Fotografije uz prijedloge

U lokalnoj aplikaciji posjetitelji s istim kodom mogu uz tekstualnu ili vizualnu
dopunu priložiti do šest fotografija, svaku do 8 MB, u formatu JPEG, PNG ili WebP.
Mogu dodati opis i ukloniti odabranu fotografiju prije slanja. Pogrešan kod ili
neuspjelo slanje zadržavaju odabir i ostala polja za ponovni pokušaj. Tekst i
vizualni prijedlog ostaju ograničeni na 64 KB; fotografije se učitavaju zasebno.

Izvornici i podaci o učitavanju čuvaju se privatno u `private/suggestions/media/`
i `private/suggestions/uploads/`. Posjetitelj ih ne može čitati preko poslužitelja.
Pregled i preuzimanje izvornika zahtijevaju obiteljsku lozinku. U **Review** prvo
pregledaj priloge i odobri prijedlog. Zatim za željene fotografije odaberi osobu i
klikni **Dodaj odabrane fotografije u nacrt**. Dostupne su i nove osobe iz već
odobrene vizualne dopune. Postojeće izmjene u nacrtu ostaju sačuvane; nedovršena
polja prvo treba dovršiti.

Fotografije ulaze u privatnu galeriju, a **Save** trajno sprema nacrt. Glavna
fotografija bira se zasebno u profilu osobe. Dodavanje u galeriju ne mijenja javnu
vidljivost niti automatski objavljuje fotografije. Izvorni bajtovi se čuvaju;
siguran nastavak naziva za preuzimanje određuje format datoteke. Odbacivanje
nacrta zadržava priloge uz prijedlog, pa ih možeš ponovno dodati.

U sigurnosnu kopiju i buduću selidbu na homelab uključi cijeli `private/suggestions/`.
To obuhvaća i nedovršena učitavanja; ništa se automatski ne briše. Nakon dodavanja
u galeriju izvorni se bajtovi kopiraju i u `private/media/`, odakle ih postojeći
postupak sigurnosnog kopiranja stabla provjerava i uključuje. Sve su to privatne
datoteke na disku. Postojeći AWS servis ostaje nepromijenjen; novi prilozi koriste
isključivo lokalni poslužitelj.

### Detailed private profiles and photographs

In a private person's profile, **Uredi podatke osobe** edits names, birth date,
maiden surname, previous names, nicknames, birthplace and free-text notes.
Previous names can span several lines. Search also matches maiden surnames,
previous names and nicknames. Residence history is an ordered list of places
with free-text `from`/`to` values; partial years and uncertain dates are preserved.
Applying the form updates only the draft; **Save** commits the tree as before.

**Glavna fotografija i galerija** accepts JPEG, PNG and WebP files from the
device, up to 8 MB each and 24 photos per person. Choose the main photo explicitly.
Original bytes are verified and kept under ignored `private/media/`; previews
are made in memory. Profile data contains references rather than base64 images.
Reading and uploading photos requires the protected local API and the current
family password. Private photo files are never in the public static manifest.
Legacy avatar URLs remain supported. Uploaded originals and backup photo copies
are unencrypted private files on disk, like the private canonical source.

The public catalog still contains only the explicitly reviewed labels and links;
extended profile fields and photographs stay private. Lock clears private photo
previews. Removing a photo from a profile, cancelling a draft or failing a save
does not delete the stored original. Unreferenced uploads remain in the private
archive for deliberate cleanup rather than being removed automatically.

`npm run backup` creates the encrypted tree backup plus a verified sibling
`<backup-file>.media/` directory when the tree references photos. Keep both
together and private. `restore --backup <file> --initialize` restores the photo
copies before committing the restored tree. A dry run verifies the backup and
its photos without writing to the destination. For a homelab migration, preserve
the private canonical source, `private/media/`, recovery storage and prepared
artifacts together; migration is a separate owner action.

### Open from a phone on the same network

Mobile decryption needs HTTPS. Keep a development certificate and its private
key under ignored `private/dev-tls/`, with the computer's LAN IPv4 address in the
certificate's subject alternative names. With OpenSSL installed, for example:

```powershell
New-Item -ItemType Directory -Path private/dev-tls -Force
openssl req -x509 -newkey rsa:2048 -noenc -keyout private/dev-tls/key.pem -out private/dev-tls/cert.pem -days 30 -subj /CN=family-local-dev -addext 'subjectAltName=IP:192.168.0.167' -addext 'basicConstraints=critical,CA:FALSE'
npm run dev -- --host 192.168.0.167 --cert private/dev-tls/cert.pem --key private/dev-tls/key.pem
```

Replace the example IP with your computer's current LAN IPv4 address, then open
`https://192.168.0.167:4173` on the phone. The phone must be on the same network;
Windows may ask to allow Node.js on private networks. The self-signed certificate
will need a browser exception or explicit trust on the phone. Verify the address
and use only the certificate you created locally. Plain HTTP on a network IP
cannot unlock the tree and is rejected by the server.

Ordinary `npm run dev` continues to listen only on `127.0.0.1`. Network mode
accepts only the configured IP and keeps the same private-file restrictions,
password, exact-Origin, and CSRF checks. Nothing is published to the internet.
The owner can unlock and edit from an HTTPS private-network address after the
protected server confirms its save capability. Plain HTTP network addresses and
public hostnames do not receive the local editing password or drafts.

## Files and boundaries

| Location | Purpose |
| --- | --- |
| `private/family.json` | Canonical plaintext, ignored by Git and never served |
| `private/backups/` | Local migration copies and encrypted backups |
| `private/transactions/` | Verified recovery files and operation receipts; contains private plaintext |
| `data/family.enc.json` | Encrypted tree, safe to publish with a strong password |
| `data/family.anchors.public.json` | Deliberately public identifiers and reviewed labels |
| `api/generated/` | Matching backend allowlist and graph revision |
| `config/production.json` | Public production endpoint/sign-in metadata |
| `config/local.json` | Optional ignored local configuration; features disabled by default |
| `dist/` | Exact public file manifest, assembled by the build |
| `data/family.template.json` | Fictional starter data |

Use Node.js 22 or newer. The static edition has no third-party npm runtime
dependencies. Browser assets are vendored.

## Maintenance

```powershell
npm run prepare -- --dry-run
npm run verify
npm run recover -- --inspect
npm run build:production
```

A dry run does not decrypt or change live family artifacts. `verify` runs one
combined syntax, fixture/API, validation, and public-build batch. On Windows, the
password wrapper prompts without putting the password in command history:

```powershell
.\scripts\family-maintenance.ps1 prepare
.\scripts\family-maintenance.ps1 backup
.\scripts\family-maintenance.ps1 release:prepare
```

Other shells can supply `FAMILY_TREE_PASSWORD` locally for one command. Never put
it in Git, GitHub Actions, a URL, or a command argument. `encrypt` and
`generate:anchors` are compatibility aliases for the complete preparation
workflow; they no longer independently replace public files.

New public labels require explicit review. Use
`npm run prepare -- --review-publication --dry-run` to write a private preview.
After inspecting it, use the password wrapper with `prepare --approve-publication`.
Do not run `enable:all-anchors` for ordinary edits: it deliberately proposes
publishing every person's display name and birthday.

## Publish

1. Save/prepare the tree locally.
2. Run `.\scripts\family-maintenance.ps1 release:prepare`. It decrypts the
   production artifact, compares it to the canonical source, and writes
   `config/publication.json` containing only the public build digest.
3. Review the changed encrypted/catalog/backend/config files and commit them,
   including the publication receipt.
4. In GitHub repository Settings → Pages, select **GitHub Actions**.
5. Run **Publish personal edition** from Actions on `main`.

The workflow uploads only `dist/` and rejects output that differs from the locally
verified release. The password and private source stay on your computer. The
receipt records a trusted maintainer's local check; it is not an independent
cryptographic proof of decryption.

The existing production endpoints were preserved in `config/production.json`.
Local guest submissions start disabled until the owner sets a code. Local review
uses the protected server and does not fall back to production AWS services.
No live cloud deployment or billing change is part of this repair.

## More detail

- [Maintainer instructions](MAINTAINER.md): setup, password rotation, restore, and publishing.
- [Privacy model](docs/privacy-model.md): public labels and the shared-password boundary.
- [Administrator review](docs/admin-review.md): review and apply additions locally.
- [Current repair progress](docs/personal-edition-repair-progress.md).
- [Stabilization plan](docs/personal-edition-stabilization-plan.md) and
  [six-stage agent playbook](docs/personal-edition-agent-plan/README.md).
