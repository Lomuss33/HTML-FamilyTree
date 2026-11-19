# Priprema za Git — 2026-11-19

Ovaj korak priprema programske promjene i provjere. Ne pokreće homelab,
Tailscale, AWS, commit, push ili objavu. Privatne datoteke ostaju na računalu.

## Sadržaj pripreme

Programske promjene čine jednu povezanu cjelinu: javni pregled i poveznice,
pretraga i profili, dodavanje članova, privatne fotografije, lokalni prijedlozi
i pregled, zajednički Save te pripremljeni odvojeni ulazi za budući homelab.
Moduli se međusobno uvoze pa ih treba uključiti zajedno s testovima i odobrenim
popisom statičkih datoteka. Homelab kod i primjer konfiguracije miruju dok se
izričito ne pokrene `npm run homelab` i zasebno ne postave mrežna pravila.

Izmjene stvarnih obiteljskih artefakata pripremaju se zasebno od koda:

- `data/family.enc.json` — šifrirano privatno stablo;
- `data/family.anchors.public.json` — odobrene javne osobe i veze;
- `api/generated/public-anchor-allowlist.json`;
- `api/generated/canonical-revision.json`.

Te četiri datoteke čine usklađen skup. Ne zamjenjivati ih pojedinačno i ne
zaključivati da lokalni Save daje odobrenje za Git push ili javnu objavu.
Programski commit ostaje kompatibilan s prethodnim katalogom bez javnih veza.
Provjera privatnog dešifriranja prije objave i dalje zahtijeva vlasnikovu lozinku
unesenu lokalno; tijekom ove pripreme stvarno stablo nije dešifrirano.

## Zaštita Git sadržaja

`.gitignore` isključuje privatnu zbirku, nacrte, lokalne konfiguracije,
rezultate testova, `.env` datoteke, ključeve i sigurnosne kopije.
`npm run check:git` pregledava **Git indeks**, odnosno točne bajtove pripremljene
za commit. Odbija zabranjene privatne putanje, kopije i prepoznatljive oblike
privatnih ključeva i pristupnih tokena. Ne ispisuje pronađene vrijednosti.
Ta provjera je dio `npm run verify`, pa se izvodi i u postojećem CI postupku.
Pretraga poznatih uzoraka nije jamstvo da je svaki mogući tajni podatak otkriven;
pripremljeni diff uvijek treba pregledati.

Jedina iznimka za privatni TLS ključ je postojeća **javna, izmišljena testna
datoteka** `test/fixtures/tls/fictional.key.pem`. Dopuštena je samo ako njezin
kontrolni zbroj odgovara poznatoj testnoj datoteci. Ne koristiti je za stvarni
poslužitelj. Pripadajući certifikat također služi samo izdvojenim testovima.

Stara datoteka `data/family.enc.json.pre-recovery.bak` uklonjena je samo iz Git
indeksa, a lokalni su bajtovi i SHA-256 zbroj sačuvani. Budući commit može
prekinuti njezino praćenje; datoteka i dalje postoji u starijoj Git povijesti.
Povijest se ne prepisuje i lozinke se ne mijenjaju automatski.

## Dodatna zaštita prijave

Provjera preglednika na izmišljenim podacima otkrila je da neuspjelo učitavanje
JS modula ostavlja obrazac bez zaštitnog handlera. Tada je izvorni zadani GET
slao izmišljenu lozinku u URL; potvrđeno je tragom mrežnih zahtjeva.
`index.html` sada drži unos i prijavu onemogućenima dok `assets/app.js` ne
postavi handler, a izvorni obrazac koristi POST kao dodatnu zaštitu.
Novi test namjerno prekida učitavanje modula i provjerava da izmišljena lozinka
ne ulazi ni u URL ni u tijelo izvornog slanja onemogućenog obrasca.
Nije korištena niti izložena stvarna obiteljska lozinka.

## Završna provjera

Programski staging ima 76 promijenjenih putanja, uključujući prestanak praćenja
stare kopije. Obiteljski artefakti nisu dodani u staging. Sadržaj indeksa
izvezen je u izdvojenu lokalnu mapu s razmacima u putanji, bez privatnog izvora
i bez lokalne sigurnosne kopije. Ovisnosti su instalirane iz predmemorije,
bez izvršavanja instalacijskih skripti.

Na toj kopiji prolaze `npm run verify` (**237/237 testova**, sintaksa
**106 modula**, izgradnja i provjera **40 datoteka**) i završni puni
`npm run test:browser` (**47/47 scenarija**). Provjereno je na Windowsu s
Node.js 24.11.1; Linux i Node.js 22 ostaju za postojeću CI matricu.
Svi scenariji spremanja, oporavka i napada koriste izmišljene testne osobe.
Privatni izvor i stvarno dešifriranje nisu dio tog izvoza.

Git provjera i provjera razmaka pripremljenog diffa prolaze. Početni i završni
kontrolni zbrojevi stvarnih privatnih datoteka i pripremljenih artefakata
podudaraju se. Nije napravljen commit, push, objava ni pristup homelabu.

## Pregled i predloženi commit

Prije ručnog commita pregledati:

```sh
git status --short
git diff --cached --stat
git diff --cached --check
npm run check:git
```

Ne koristiti `git add .` za ovaj korak: time bi se mogle uključiti i odvojene
izmjene stvarnih artefakata. Pregledati pripremljeni sadržaj u lokalnom Git
alatu. Prijedlog poruke za programski commit:

```text
feat: complete personal archive workflows and prepare isolated homelab access

Add public tree navigation, profile and family editing, private media and local
suggestion review while retaining the shared validated save workflow.
Prepare separate public/private homelab listeners and guard the Git index
against private files, recovery copies and recognizable credential material.
Keep password entry disabled until its protected handler is ready.
```

GitHub Pages workflow u `.github/workflows/pages.yml` ima samo ručno pokretanje
`workflow_dispatch`. To samo po sebi ne određuje ponašanje postojećeg Pages
hostinga. Pri naknadno odobrenom pushu udaljeni Pages API pokazao je
`build_type: legacy`, izvor `main` i put `/`: push u `main` može automatski
objaviti sadržaj neovisno o ručnom workflowu.

Zato je za programski push odabrana zasebna grana
`prep/personal-archive-stabilization`. `main` i Pages postavke ostaju nepromijenjeni.
Spajanje te grane u `main` također može izazvati objavu i traži zasebnu odluku.
Vlasnik je odobrio commit/push koda, a nije odobrio automatsku objavu ili
promjenu Pages postavki. Ranija provjera staginga nije provjeravala udaljene
postavke; ovaj dodatak ispravlja pretpostavku izvedenu samo iz workflow datoteke.
Ručni workflow i dalje zahtijeva zasebnu pripremu i provjeru releasea.
