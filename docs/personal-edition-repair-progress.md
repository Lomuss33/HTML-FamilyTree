# Personal edition repair progress

Implementation: 2026-10-14. Baseline: d5dc772. User help level: High.
User requested implementation first and one consolidated final verification pass.

## Owner decisions

- DEC-01: Preserve the original local legacy private JSON as the intended source.
- DEC-02: Keep exactly the existing 15 public catalog entries and reconcile their current labels.
- Do not request the production family password in chat; enter it locally.
- No cloud deployment, repository push, or billing change was requested or performed.

## Stage status

| Stage | Status | Delivered |
| --- | --- | --- |
| 1. Preserve/repair data | implemented | Verified private migration backup; source moved to private/family.json; 22 absent relationship arrays repaired; exact 15 opt-ins reconciled |
| 2. Secure local access | implemented | Loopback-only server; 25-file publication manifest; protected JSON/token/Origin/Host API; bounded bodies; private/repository paths denied |
| 3. Unify saving/recovery | implemented | Shared five-file workflow; real encryption and round-trip check; full private revisions; idempotent receipts; staged replacement, rollback and restart recovery |
| 4. Publication/config | implemented | Separate local/production config; deterministic dist assembly; freshness/tracking checks; manual Pages workflow with locally verified release digest |
| 5. Editing/review | implemented | Memory-only family session; cloned saved/draft state; stale-tab protection; explicit public-label review; draft export; fresh review metadata; repeat patch download; late-response guards |
| 6. Verify/release | local main checks complete; release pending | Consolidated fixture/API checks, focused fixes, production build, browser smoke, backup/restore and runbooks |

The original real ciphertext, catalog, allowlist, and public revision remain
unchanged. A local Save/prepare with the family password is still needed to
regenerate the ciphertext with repaired metadata.

## Final verification evidence

The single full run exercised 147 cases: 145 passed initially. Its two failures
were a frozen test fixture and a private-name scanner false positive on the
generic surname “Person”. The fixture was corrected and scanning now matches
complete string/text values or full names, instead of substrings of identifiers.
The affected maintenance file then passed all four cases.

One regression case was added for that scanner fix. The affected publication
file passed all four cases. **148 distinct cases passed across that
consolidated batch and necessary focused reruns.** The full suite was not
repeated during that pass after those fixes.

Verified main areas:

- Valid and invalid graphs, minimal migration, consent reconciliation and conflicting sources.
- Five matching outputs, wrong passwords, display-only stale edits, Node/Web Crypto compatibility.
- Nine staged/replacement failure points; failed rollback blocks writes; recovery restores the old set.
- Exact public-label approval binding and expiry.
- Manifest-only GET/HEAD serving, traversal/private paths, Host/Origin/token/content-type/body limits.
- Deterministic build, failed assembly preservation, linked-source rejection and private canary detection.
- Real encrypted backup restored into an empty isolated project; initialization refuses overwrite.
- Password rotation; accepted-patch retry without duplicate additions; conflicting patch rejection.
- Release blocked without local decryption; public changes invalidate the release receipt.
- Syntax check of 67 JavaScript modules in the main pass.
- PowerShell password wrapper parsed successfully.
- Locked API dependencies installed and both handlers/SDK packages loaded without cloud calls.
- Production dist assembled successfully with 24 files; local source/artifact freshness verified.
- Git whitespace review passed after correcting whitespace in the vendor patch.

Browser smoke used the T3 collaborative preview with fictional data only:

- Unlock, edit/submit a card, Save, Lock, and unlock the saved ciphertext.
- Accents and HTML-like names render as text in both cards and edit inputs.
- No family nodes written to session storage; Lock removes the chart.
- Disabled review/suggestion controls are hidden; the CSS override found during smoke was fixed.
- No horizontal overflow at the measured 974 × 608 viewport.

The preview server was stopped after the browser check. Automatic approval review
blocked removal of the temporary fictional fixture folder
`family-repair-fMeFLp` with “blocked by policy”; it was left intact outside the
repository. No real family data was used in that folder.

## Remaining release checks

- Enter the real password locally, Save/prepare, then run release:prepare.
- Inspect the final public catalog and generated Git changes; commit the release receipt.
- The real encryption/source association cannot be proved without that password.
- Run the configured Ubuntu/Windows Node 22/24 and Chromium CI jobs on GitHub; only local Node 24 and the T3 preview were exercised here.
- Physical iOS/Android checks remain pending. A 390 px layout was verified during the continuation below.
- Live Cognito redirect, API deployment alignment, and hosted Pages URL require a chosen deployment and credentials.
- The publication receipt records the maintainer's local check; it is not an independently signed proof.

See [MAINTAINER.md](../MAINTAINER.md) for exact commands. Do not bypass the
password or release-digest gates to claim a production release.

## Continuation: editor completion and reproducible publication

Implemented without changing the real canonical/encrypted/public artifacts:

- Page Save and Download draft include unfinished card fields.
- Cancelling a card, navigating away, Lock, and page navigation recognize those fields as unsaved.
- Phone-width editing uses a contained, scrolling form and a compact two-column toolbar; controls target 44 CSS px and text inputs use 16 px.
- Public text uses deterministic LF bytes across Windows/Linux. Local payload fingerprints use those bytes; original encrypted source files and old migration receipt bindings are preserved.
- Downloaded private draft filenames are ignored and rejected if forcibly tracked.
- Four fictional Chromium browser cases were added, with external requests blocked.
- Manual Pages publication now waits for the reusable full verification workflow.
- The fictional preview can exercise a repository subpath. Local server port errors are reported cleanly.

Verification was postponed until implementation was finished, as requested:

- **One complete npm run verify: 150 tests passed, zero failed/skipped.**
- 73 JavaScript modules passed syntax checks.
- Canonical/public freshness and the 25-file local build passed.
- The release command regression rebuilt CRLF source files and retained the exact locally verified release digest.
- A real HTTP fixture confirmed migrated CRLF ciphertext unlocks correctly through normalized public bytes; its source ciphertext remained byte-for-byte unchanged.
- Git whitespace review passed; real encrypted/catalog/backend artifacts have no diff.
- Browser test discovery found all four cases. The standalone Chromium runner was not executed locally; its CI run remains pending.

T3 browser checks used fictional data on loopback only:

- Page Save captured a field without an individual card Submit.
- Cancelling a card and Lock each respected a decision to keep unfinished edits.
- A 390 × 568 frame loaded under /family-preview/, without horizontal overflow; the form fit, text input font was 16 px, and Save measured 43.99 px at desktop scaling.
- A simulated client transport loss occurred after a real commit; receipt lookup returned that committed result.
- A subsequent stale UI save kept its visible draft and offered a private download.
- Family session storage remained empty.

Native preview resizing continued to time out. The phone layout check used a same-origin frame in the T3 preview; it does not replace a physical mobile-browser check.

Recovery/admin changes appeared concurrently after the main verification batch.
They were preserved. A necessary focused integration run of file recovery,
administrator review, and family workflow tests passed all 31 cases, including
ten additional cases. It demonstrated process-exit recovery at six boundaries,
preflight verification of all recovery copies, preservation of manual rescue
edits, relationship-order preservation, and tolerance of unavailable optional
auth storage. This brings coverage to 160 distinct passing cases across the
main batch and focused integration run; no second full-suite loop was run.

The concurrent CLI diagnostic-redaction changes were also preserved. Their
affected canonical/maintenance/cross-platform files passed a focused nine-case
run, including one additional private-diagnostic canary. The current evidence
therefore covers 161 distinct passing cases across the main run and necessary
integration checks. The four CI browser scenarios remain separately recorded
as discovered and awaiting a GitHub run.

## Nastavak 2026-11-18: ispravci podataka o javnoj osobi

1. **Potvrđeno:** javni profil nije imao obrazac za predlaganje pojedinih
   profilnih podataka. Tekstualne poruke zahtijevale su ručno prepisivanje.
   Nakon ponovnog pokretanja alata aktivni razvojni poslužitelj slušao je samo
   na adresi za ovo računalo.
2. **Provedeno:** `assets/suggestions/profile-change*.js` dodaje prazna, izričito
   odabrana polja bez dohvaćanja privatnog profila. `scripts/lib/local-suggestions.mjs`
   provjerava kod, javnu osobu, katalog, dopuštena polja, inačicu pregleda i cijelog
   stabla. `assets/admin/review-workspace.js` prikazuje usporedbu i odabir polja;
   `assets/app.js` dodaje odobrene promjene u postojeći nacrt. Staro odobrenje
   nakon novog spremanja zahtijeva ponovni pregled. Jednake vrijednosti ne stvaraju
   lažno nespremljen nacrt. Razvojni HTTPS poslužitelj ponovno sluša na lokalnoj mreži.
3. **Očuvano:** postojeći Save, Discard, Lock, šifriranje, identifikatori, veze,
   fotografije i javne oznake. Bilješke i mjesta života dodaju se prethodnim
   zapisima. Slobodne poruke i vizualne dopune ostaju dostupne. AWS ugovor ostaje
   nepromijenjen; novi obrazac koristi samo lokalni poslužitelj.
4. **Provjereno:** `npm run verify` prolazi svih **218 testova**, sintaksu
   **97 modula** te provjeru i izgradnju javnog paketa od **38 datoteka**.
   `npm run test:browser` prolazi sva **33 testa** u Chromiumu, uključujući
   ispravak na širini 390 px, pogrešan kod, povučenu javnu osobu, očuvanje unosa,
   odabir dijela polja, odbacivanje i ponovno dodavanje, neuspjelo spremanje,
   zaseban Save i brisanje privatne usporedbe nakon Locka. `git diff --check` prolazi.
   Provjere u pregledniku koriste isključivo izmišljena stabla; fizički mobitel,
   stvarno dešifriranje vlasnikovom lozinkom i objavljeni AWS nisu ponovno testirani.
5. **Preostalo:** obrazac nije postavljen na javni AWS servis. Stalni rad na
   homelabu i pristup izvan lokalne mreže ostaju zaseban sljedeći korak.
6. **Sigurnost podataka:** kontrolni zbrojevi svih pet stvarnih obiteljskih
   datoteka jednaki su početnima iz ovog koraka. Postojeće sigurnosne kopije nisu
   mijenjane. Nije bilo commita, pusha, objave ni izmjena AWS-a ili postavki Pagesa.
   Stvarni HTTPS odgovara s 200 za preglednik i status; pristup privatnoj datoteci
   vraća 404. Poslužitelj je pokrenut skriveno, bez otvorenog prozora terminala.
7. **Sljedeće:** vlasnik lokalno uključi kod kroz **Review → Kod za slanje
   prijedloga**, zatim može isprobati **Predloži ispravak** u javnom profilu.
   Preseljenje treba prenijeti stablo, privatne fotografije i cijelu mapu prijedloga.

## Nastavak 2026-11-18: tamni prikaz i jednostavniji ulaz

- Prema vlasnikovu odabiru prvi zaslon sadrži kratak uvod i glavni gumb za
  javno stablo. Javna pretraga i administratorska prijava nalaze se u sklopivim
  odjeljcima. Obrazac s obiteljskom lozinkom i postojeći postupak otključavanja
  ostaju isti. Nakon Locka odjeljci se ponovno zatvaraju.
- `index.html` i `assets/app.css` koriste tamne podloge, čitljive kartice i
  ujednačene obrasce, uz očuvanje izvornih boja fotografija. Postojeća biblioteka
  stabla i obiteljski model nisu zamijenjeni.
- Potvrđen je i ispravljen nedostatak javne pretrage: njezini rezultati prije
  nisu bili interaktivni. `assets/app.js` sada izravno otvara odabrani javni
  profil, dodirom ili tipkovnicom, bez dohvaćanja privatnog stabla.
- `npm run verify` prošao je svih **218 testova**, sintaksu **97 modula** i
  provjeru javnog paketa od **38 datoteka**. Cijeli `npm run test:browser` prošao
  je sva **34 testa**. Novi slučaj provjerava početni prikaz pri širini 390 px,
  vidljivost glavnog gumba bez pomicanja, dodirnu površinu od najmanje 44 px,
  kontrast teksta glavnog gumba od najmanje 4,5:1, sklopive odjeljke i otvaranje
  javnog profila. Snimke za pregled izgleda koriste samo izmišljene podatke.
  Nakon dorade čekanja završetka animacije ponovljen je samo taj ciljani slučaj.
- Kontrolni zbrojevi svih pet stvarnih obiteljskih datoteka ostali su isti.
  Sigurnosne kopije nisu mijenjane. Nije bilo commita, pusha, objave ni pristupa
  AWS-u, Proxmoxu ili Tailscale mreži. Fizički mobitel nije testiran ovim alatom.
- Vlasnik je potvrdio Proxmox i Tailscale kao buduće okruženje. Sadašnja je
  namjera dovršiti izgled i funkcije prije hostanja; udaljenom se stroju ne
  pristupa niti se na njemu išta mijenja.

### Naknadni odabir: povratak prethodne palete

Na vlasnikov zahtjev vraćene su izvorne boje: tople bež podloge, zelene akcije,
tamnozelena pozadina stabla i pastelne kartice. Novi raspored i sve funkcije
ostaju. Prošla su tri ciljana testa u pregledniku za početni zaslon, profil s
fotografijama i pregled vizualne dopune te izgradnja i provjera javnog paketa.
Razvojni HTTPS poslužitelj prikazuje vraćenu paletu. Kontrolni zbrojevi pet
stvarnih obiteljskih datoteka nepromijenjeni su.

## Nastavak 2026-11-18: mobilna kartica osobe

1. **Potvrđeno:** na mobitelu je velik dio profila zauzimao popis osoba, a samo
   smanjenje dijaloga prekrilo bi središnju karticu stabla. Ponovni odabir iste
   osobe također je ponovno stvarao obrazac i tražio odbacivanje njegova unosa.
2. **Provedeno:** `index.html`, `assets/app.css` i
   `assets/viewer/person-browser.js` koriste mobilnu donju karticu s gumbom
   **← Pretraga**. Povratak na popis i ponovno otvaranje iste osobe čuvaju polja.
   Prelazak na drugu osobu i zatvaranje zadržavaju potvrdu odbacivanja. Promjena
   podataka osvježava profil i kada je odabrana ista osoba.
3. **Očuvano:** prethodna paleta, obiteljski podaci, veze, privatnost, fotografije
   i način spremanja. Računalo zadržava popis i profil u dva stupca.
   `assets/app.js` koristi postojeći API biblioteke samo za položaj odabrane
   osobe iznad kartice. Aktivni uređivač i nesigurno ili aktivno spremanje ne
   pokreću taj pregled. Odabir i stanje prikaza ostaju samo u memoriji kartice.
4. **Provjereno:** `npm run verify` prolazi svih **218 testova**, sintaksu
   **97 modula** i izgradnju/provjeru paketa od **38 datoteka**. Cijeli
   `npm run test:browser` prolazi svih **35 testova**. Novi test na izmišljenim
   podacima provjerava vidljivost odabrane osobe iznad kartice, visine zaslona
   844 i 568 px, povratak na pretragu, očuvanje polja, potvrdu promjene osobe,
   prelazak na širinu računala te ispravne podatke nakon izmjene i odbacivanja
   nacrta. Postojeće provjere javnih profila ne dohvaćaju privatno stablo.
5. **Ograničenja:** provjeren je Chromium s promjenom veličine prozora, a ne
   fizička tipkovnica i preglednik na vlasnikovu mobitelu. Hostanje ostaje za
   kasniju fazu nakon dorade izgleda i funkcija.
6. **Sigurnost:** svih pet kontrolnih zbrojeva stvarnih obiteljskih datoteka
   odgovara stanju prije ovog koraka. Sigurnosne kopije nisu mijenjane. Nema
   commita, pusha, objave ni pristupa AWS-u, Proxmoxu ili Tailscale mreži.
   Lokalni HTTPS prikazuje novu karticu; privatni obiteljski HTTP put vraća 404.
7. **Sljedeće:** vlasnik može provjeriti karticu na svojem mobitelu. Odabir
   broja odmah prikazanih generacija ostaje zasebna odluka za sljedeću doradu.

## Nastavak 2026-11-18: najbliža obitelj oko odabrane osobe

1. **Potvrđeno:** prethodni prikaz pokazivao je više generacija, ali nije
   uključivao braću/sestre. Samo ograničenje dubine na jednu generaciju ostavilo
   bi i partnere djece. Oba su ponašanja reproducirana na izmišljenoj obitelji.
2. **Provedeno:** `assets/app.js` ograničava pretke i potomke na jednu generaciju
   i prikazuje braću/sestre odabrane osobe. Postojeći poziv za prilagodbu
   rasporeda skriva partnere djece dok netko od te djece ne postane središnja
   osoba. `assets/viewer/person-browser.js` prikazuje popis braće/sestara prema
   barem jednom zajedničkom upisanom roditelju. Naslov označava najbližu obitelj.
3. **Očuvano:** puna zbirka ostaje ulaz biblioteke i uređivača. Ograničenje ne
   filtrira izvor za Save, ne mijenja obiteljske veze i ne izmišlja partnerstvo
   između roditelja zajedničkog djeteta. Ostale se generacije otvaraju odabirom
   rođaka, a nepovezane osobe ostaju dostupne pretragom. Paleta je ista.
   Biblioteka nije mijenjana; korištena konfiguracija opisana je u
   `docs/vendor-patches.md` radi budućih nadogradnji.
4. **Provjereno:** `npm run verify` prolazi svih **218 testova**, sintaksu
   **97 modula** i izgradnju/provjeru paketa od **38 datoteka**. Testna obitelj
   `valid-nearest-family.json` sadrži 21 izmišljenu osobu, uključujući
   polubraću/polusestre, više partnera i udaljene grane. Test preglednika
   provjerava točan skup kartica pri navigaciji te uspoređuje cijeli izvor i
   dešifriranu datoteku prije i nakon izmjene rođenja i zasebnog Savea.
5. **Rezultati preglednika i ograničenja:** potpuni paket završio je s 35/37.
   Ispravljeno je očekivanje redoslijeda oznaka u novom javnom testu. Drugi
   scenarij dosegnuo je vremensko ograničenje tijekom paralelnih provjera,
   dok je još prikazivao otključavanje. Ciljano ponavljanje oba slučaja prošlo
   je **2/2**, uključujući postojeći Discard/Reload/Lock za 4,8 s. Time je
   provjereno svih 37 različitih scenarija; cijeli paket nije ponovno pokrenut.
   Novi javni slučaj potvrđuje da se veza ne izvodi preko privatnog roditelja
   i da se privatno stablo ne dohvaća. Fizički mobitel nije testiran.
6. **Sigurnost podataka:** svih pet stvarnih obiteljskih datoteka ima iste
   kontrolne zbrojeve kao prije koraka. Postojeće sigurnosne kopije nisu
   mijenjane. Nema commita, pusha, objave ni pristupa AWS-u, Proxmoxu ili
   Tailscale mreži. Lokalni HTTPS prikazuje novu inačicu, a privatni put je 404.
7. **Sljedeće:** vlasnik može provjeriti najbližu obitelj u lokalnom prikazu.
   Stvarni javni katalog ovim korakom nije ponovno pripreman; ranije zabilježena
   priprema javnih veza i dalje prolazi kroz vlasnikov pregledani Save.

## Jednostavnije dodavanje i povezivanje — 2026-11-19

1. **Potvrđena poteškoća:** profil je prikazivao članove obitelji, ali nije
   nudio jednostavan postupak za dodavanje nove ili povezivanje postojeće
   osobe u ulozi roditelja, partnera, brata/sestre ili djeteta. Za izmjene je
   trebalo koristiti postojeće kontrole uređivača stabla.
2. **Promijenjeno:** `assets/editor/family-edit-form.js` daje jedan obrazac s
   izborom nove/postojeće osobe, pretragom, upozorenjem na jednako ime i
   sažetkom odabrane veze. `assets/viewer/person-browser.js` dodaje četiri
   gumba u privatni profil i **Dodaj osobu** u pretragu za nepovezanu granu.
   `assets/editor/family-edit.js` priprema potpunu kopiju nacrta i obostrane
   veze, uz zaštitu od samopovezivanja, trećeg roditelja, ponovljene veze i
   kruga predaka. Braća/sestre dijele samo izričito odabrane postojeće
   roditelje; drugi roditelj djeteta nije automatski odabran.
3. **Očuvano:** `assets/app.js` primjenjuje i nedovršenu karticu prije nove
   operacije, čuva sve skrivene grane i koristi postojeći Save. Novi zapisi
   dobivaju zasebnu oznaku i privatnu vidljivost; postojeći podaci, oznake i
   javne postavke ostaju sačuvani. Nevaljana operacija zadržava obrazac bez
   djelomičnog mijenjanja veza. Odustajanje, Esc i povratak traže potvrdu
   odbacivanja unosa. Paleta i format šifriranja nisu promijenjeni. U
   `scripts/lib/publication.mjs` odobrena su samo dva nova statička modula.
4. **Provjereno:** `npm run verify` prolazi svih **226 testova**, sintaksu
   **100 modula** i izgradnju/provjeru paketa od **40 datoteka**. Osam novih
   testova u `test/family-edit.test.mjs` provjerava pravila i nepromijenjeni
   izvor nakon pogreške. Cijeli `npm run test:browser` prolazi **41/41**:
   četiri nova scenarija koriste izmišljene osobe, stvarno spremanje i
   dešifriranje, usporedbu cijele zbirke, neuspjeli HTTP Save, očuvanje
   nedovršene kartice, Discard, Lock, upozorenje za duplikate i javni prikaz.
   Tijekom provjere ispravljeni su premali tekst mobilnih polja i skriveni
   povratni gumb na računalu. `git diff --check` nema pogrešaka razmaka.
5. **Ograničenja:** mobilni unos provjeren je u Chromiumu pri širini 390 px;
   fizički mobitel nije testiran. Brat/sestra bez poznatog zajedničkog
   roditelja ne povezuje se izmišljanjem roditelja. Može se dodati nepovezan
   zapis ili prvo upisati poznatog zajedničkog roditelja. Stvarno šifrirano
   stablo nije dešifrirano tijekom ovog koraka.
6. **Sigurnost podataka:** svih pet stvarnih obiteljskih datoteka ima iste
   SHA-256 kontrolne zbrojeve kao prije koraka, provjereno i nakon pokretanja
   lokalnog poslužitelja. Postojeće sigurnosne kopije nisu mijenjane. Nema
   commita, pusha, objave, promjene lozinke ni pristupa AWS-u ili homelabu.
   Lokalni HTTPS poslužuje oba nova modula i obrazac, lokalni API je spreman,
   a `/private/family.json` vraća 404. Prije pokretanja potvrđeno je da nema
   nedovršenih operacija spremanja.
7. **Sljedeće:** isprobati postupak **profil → Dodaj člana → nova/postojeća
   osoba → Dodaj u nacrt → Save** na lokalnoj stranici. Ovim korakom stvarni
   javni katalog nije ponovno pripreman; priprema javnih veza i dalje
   zahtijeva vlasnikov zasebni pregledani Save.

### Nastavak provjere obrazaca — 2026-11-19

1. **Potvrđeno:** ponovljenim prelaskom s postojećeg na novo dijete ranije
   odabrani zapis ostajao je pogrešno isključen iz pretrage drugog roditelja.
   Novi scenarij preglednika reproducirao je nedostajući rezultat prije popravka.
2. **Ispravljeno:** `assets/editor/family-edit-form.js` osvježava izbore prema
   aktivnoj vrsti unosa. Nevaljani odabir iste osobe kao djeteta i njegova
   roditelja uklanja se; valjani odabir ostaje. Dodatni test uhvatio je nuspojavu
   promjene načina unosa pri izboru podudaranja, pa se sada najprije odabire
   konkretan postojeći zapis. Sažetak braće/sestara odmah navodi imena označenih
   zajedničkih roditelja i dostupan je čitačima zaslona.
3. **Očuvano:** upisano ime, rođenje, postojeći identifikatori, polja i javne
   postavke, puna zbirka i izričit izbor drugog roditelja. Postupak nacrt/Save,
   šifriranje i paleta nisu promijenjeni.
4. **Provjera:** završni `npm run verify` prolazi **226/226 testova**, sintaksu
   **100 modula** i provjeru paketa od **40 datoteka**. Završni cijeli
   `npm run test:browser` prolazi **43/43**. Dva nova scenarija uspoređuju cijeli
   nacrt s izmišljenim izvorom, potvrđuju da skrivena polja novog unosa ne
   prepisuju postojeću osobu i provjeravaju Discard bez spremanja.
5. **Ograničenja:** fizički mobitel i stvarno dešifriranje nisu testirani u
   ovom koraku. Priprema stvarnih javnih veza i dalje zahtijeva vlasnikov Save.
6. **Sigurnost:** pet stvarnih datoteka ostalo je bajtno jednako početnom stanju,
   provjereno SHA-256 i nakon osvježavanja poslužitelja. Postojeće sigurnosne
   kopije nisu mijenjane; nema commita, pusha, objave, AWS-a ni pristupa homelabu.
   Prije osvježavanja potvrđeno je da nema nedovršenih operacija ni brave
   spremanja. HTTPS isporučuje obrazac jednak izvornom kodu, lokalno spremanje
   je dostupno, a privatni put vraća 404.
7. **Sljedeće:** osvježiti lokalnu stranicu i koristiti postojeći postupak
   dodavanja u nacrt pa zasebnog Savea.

## Priprema javnog i privatnog homelab ulaza — 2026-11-19

1. **Potvrđeno:** postojeći lokalni poslužitelj na istom ulazu nudi javni
   pregled, šifrirano privatno stablo i administratorski API. Prednji dio također
   nije prepoznavao privatni HTTPS DNS naziv kao mjesto za lokalno spremanje.
   Samo izlaganje takvog ulaza internetu ne bi ostvarilo odabranu podjelu pristupa.
2. **Pripremljeno:** `scripts/homelab-server.mjs` i primjer
   `config/homelab.example.json` pokreću dva različita loopback ulaza jedne
   aplikacije. `scripts/local-server.mjs` ograničava javni ulaz na statičke
   datoteke bez šifriranog stabla, minimalni status prijedloga i slanje uz kod.
   Ostali API zahtjevi odbijaju se i s valjanim vlasnikovim vjerodajnicama.
   Privatni ulaz zadržava postojeću lozinku i sve zaštite spremanja.
3. **Očuvano:** ista zbirka, format šifriranja, javni pregled i postupak
   pregled/nacrt/Save. Uspješan Save osvježava oba ulaza iz iste spremljene
   inačice. Frontend prepoznaje privatni HTTPS ulaz označen poslužiteljem;
   javni ulaz ne nudi administratorsku prijavu i ne dohvaća privatno stablo.
   Homelab način ne koristi proizvodne AWS adrese. Uobičajeni lokalni način
   i postojeći paket za GitHub Pages ostaju kompatibilni.
4. **Provjereno:** `npm run verify` prolazi **234/234 testa**, sintaksu
   **104 modula** i izgradnju/provjeru paketa od **40 datoteka**. Osam novih
   integracijskih testova provjerava zabrane javnih putanja, krivotvorena
   zaglavlja, točne Host/Origin vrijednosti, javne prijedloge i fotografije,
   privatni Save i javno osvježavanje, neuspjeh/retry, konfiguraciju, zauzete
   portove i stvarno pokretanje CLI-ja na Windowsu s putanjom s razmacima.
   Cijeli `npm run test:browser` prolazi **46/46**: tri nova scenarija koriste
   izdvojene izmišljene osobe, dva stvarna lokalna HTTPS posrednika i DNS naziv.
   Provjereni su javni pregled/slanje bez privatnih dohvata, privatna prijava,
   pregled prijedloga, pregledani Save, javno osvježavanje i zaključavanje.
   Neuspjeli status prijedloga ne prekida javni pregled. `git diff --check`
   prolazi; Git prijavljuje samo postojeće Windows CRLF/LF obavijesti.
5. **Ograničenja:** Tailscale Serve/Funnel, pravila za vlasnikove uređaje,
   vanjski internet, SSH, Proxmox i automatsko pokretanje servisa nisu postavljeni
   ni testirani na odredištu. Stvarno šifrirano stablo nije dešifrirano. Podjela
   je svojstvo novog homelab načina, ne postojećeg običnog statičkog hostinga.
6. **Sigurnost podataka:** početni i završni SHA-256 popisi svih **44 datoteka
   u `private/`**, uključujući postojeće kopije, te četiri pripremljene obiteljske
   datoteke izvan te mape podudaraju se. Nisu mijenjani stvarni podaci, lozinka
   ni kod za prijedloge. Nema commita, pusha, objave ni pristupa udaljenom stroju.
7. **Sljedeće:** prema `docs/homelab.md` prenijeti provjerenu kopiju na zasebno
   homelab okruženje, prvo postaviti privatni pristup, a potom zasebno javni.
   Pri postavljanju provjeriti granice s isključenim Tailscaleom i s neodobrenog
   uređaja. Administratorski ulaz i SSH moraju ostati izvan javnog pristupa.

## Završna priprema za Git — 2026-11-19

1. **Potvrđeno:** Git je pratio staru šifriranu kopiju
   `data/family.enc.json.pre-recovery.bak`; postojeća pravila nisu isključivala
   opće `.env`, ključne i rezervne datoteke. Nova provjera indeksa prvo je
   zaustavila pripremu upravo zbog praćene kopije.
2. **Promijenjeno:** `.gitignore` i `scripts/check-git.mjs` štite indeks od
   privatnih putanja, lokalne konfiguracije, kopija i prepoznatljivih obrazaca
   vjerodajnica. Provjera ne ispisuje njihove vrijednosti i dio je `verify`.
   Iznimka za javni izmišljeni TLS ključ vezana je uz njegov poznati SHA-256;
   proizvoljan ključ pod tim imenom odbija se. Tri testa provjeravaju stvarni
   Git indeks, prisilno dodavanje, razliku indeksa i radne kopije te TLS iznimku.
   Stara kopija uklonjena je samo iz indeksa; lokalni bajtovi ostali su jednaki.
3. **Dodatni potvrđeni problem:** prekid učitavanja JS modula u pregledniku
   otkrio je izvorno GET slanje obrasca za lozinku. Mrežni trag potvrdio je
   izmišljenu lozinku u URL-u. Unos i prijava sada su onemogućeni do postavljanja
   zaštitnog handlera, a obrazac ima POST kao dodatnu zaštitu. Test namjerno
   prekida modul i provjerava odsutnost lozinke iz URL-a i izvornog zahtjeva.
   Regresijskim testovima ispravljeno je i blokiranje javnog gumba nastalo
   tijekom dodavanja te zaštite. Stvarne vjerodajnice nisu korištene.
4. **Provjereno:** iz sadržaja staginga napravljena je izdvojena lokalna kopija
   bez privatnog izvora i bez promjena obiteljskih artefakata koje ostaju
   izvan staginga. `npm run verify` prolazi **237/237 testova**, sintaksu
   **106 modula** i paket od **40 datoteka**. Završni cijeli niz preglednika
   prolazi **47/47**. Provjereni su i Git indeks te razmaci staged diffa.
   Provjera je izvedena na Windowsu i Node.js 24.11.1; CI ostaje za Linux/Node 22.
5. **Predano:** 76 promijenjenih putanja u stagingu i pregled u
   `docs/git-preparation.md`, s prijedlogom poruke za programski commit.
   Izmjene obiteljskih artefakata ostaju zasebno. Postojeći Pages workflow
   pokreće objavu samo ručno; udaljene postavke nisu mijenjane ili provjeravane.
6. **Sigurnost:** SHA-256 popisi svih 44 datoteka u `private/` i četiri
   pripremljene obiteljske datoteke ostali su jednaki početnom stanju.
   Lokalna stara kopija ima isti kontrolni zbroj; Git povijest nije prepisivana.
   Nema commita, pusha, objave, promjene lozinke, AWS-a ni pristupa homelabu.
7. **Sljedeće:** vlasnikov pregled staged diffa i zasebna odluka o ručnom
   commitu/pushu. Stvarna objava i postavljanje homelaba ostaju odvojene radnje.

### Odobrenje pusha i provjera stvarnih Pages postavki — 2026-11-19

- Vlasnik je zatim odobrio commit i push pripremljenog koda, uz vođenu pripremu
  za homelab koju će sam pažljivo provoditi. Obiteljski artefakti ostaju odvojeni.
- Provjeren je udaljeni Pages API: postojeći hosting koristi `legacy` izvor
  `main` na `/`, pa ručni workflow nije dovoljan dokaz da push ne objavljuje
  stranicu. Za push je odabrana nova grana `prep/personal-archive-stabilization`.
  `main`, Pages postavke i javna stranica ne mijenjaju se ovom radnjom.
- Dodane su prve upute za vlasnika: još nema zaseban gost; prvo se provjeravaju
  Proxmox resursi i odabiru administratorski uređaji. Konkretne mrežne adrese
  i identiteti koje je vlasnik pokazao nisu zapisani u repozitorij.
