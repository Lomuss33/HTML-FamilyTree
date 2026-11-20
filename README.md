# Šifrirana kopija projekta za prijelaz na Fedoru

Kopija je javno dostupna, ali njezin je sadržaj šifriran GnuPG-om (AES-256).
Za otvaranje je potrebna vlasnikova lozinka unesena pri izradi kopije.
Ta lozinka nije spremljena u repozitorij i nije zamjena za postojeću obiteljsku lozinku.

Snapshot: 2026-11-20T09:45:21.143Z.
Programska polazna revizija: 32fde450f9bd27ac8e854f7bea76d5f34a29e846.
Uključene su i lokalne promjene te nepraćene datoteke koje su postojale u trenutku kopiranja.

Unutra su cijeli izvor projekta, .git, private/, lokalna konfiguracija, obiteljski artefakti,
mediji, lokalni prijedlozi i postojeće sigurnosne kopije. Obuhvaćen je samo projekt,
a ne ostale osobne datoteke ili postavke Windowsa izvan njegove mape.
Izostavljeni su obnovljivi node_modules, api/node_modules, dist i rezultati testova.

## Obnova na Fedori

Pokreni naredbe redom kao običan korisnik. Ako neka ne uspije, zaustavi postupak.

1. Instaliraj potrebne alate i provjeri da Node.js ima verziju 22 ili noviju:

    sudo dnf install git nodejs gnupg2 tar
    node --version
    npm --version

2. Preuzmi baš ovu granu:

    git clone --single-branch --branch backup/fedora-migration-2026-11-20-494493 https://github.com/Lomuss33/HTML-FamilyTree.git family-tree-migration-backup
    cd family-tree-migration-backup
    sha256sum -c SHA256SUMS

3. Postavi privatne dozvole za nove datoteke, dešifriraj i raspakiraj u novu mapu.
GnuPG će tražiti lozinku kopije kroz svoj upit. Nemoj je pisati u naredbeni redak.

    umask 077
    gpg --output family-tree-migration.tar --decrypt family-tree-fedora-2026-11-20T09-45-11-506Z.tar.gpg
    mkdir restored
    tar -xkf family-tree-migration.tar -C restored
    node verify-restored.mjs restored/family-tree-migration

Provjera mora vratiti verified: true prije rada u obnovljenom projektu.
Ona provjerava bajtove svih datoteka, uključujući Git i privatne kopije.
Uobičajeni Git i aplikacijski rad poslije mijenjaju njihove radne datoteke.

4. Instaliraj Linux ovisnosti i pokreni postojeći lokalni postupak:

    cd restored/family-tree-migration/project
    npm ci --ignore-scripts
    npm ci --prefix api --ignore-scripts
    npm run verify
    npm run local

Otvori http://127.0.0.1:4173 i koristi postojeću obiteljsku lozinku.
Provjeri osobe, veze, fotografije i lokalne prijedloge prije nastavka homelaba.
Obnovljena mapa već sadrži svoju Git povijest i sačuvane radne izmjene.

Dešifrirani tar, mapu restored/ i privatne podatke zadrži izvan javnog Gita.
Ova grana služi samo kopiji; nije spojena u main i ne mijenja GitHub Pages.

## Provjera ove kopije

Prije slanja obavljena je lokalna obnova s usporedbom svih SHA-256 zbrojeva.
Nakon pusha kopija se ponovno preuzima u novu mapu, dešifrira i provjerava.
Završnu potvrdu tog koraka daje završni izvještaj asistenta.
Kod je prethodno prošao 237 testova i dva ciljana testa nove navigacije.

## Službene upute

- Node.js na Fedori: https://developer.fedoraproject.org/tech/languages/nodejs/nodejs.html
- GnuPG dešifriranje: https://gnupg.org/gph/en/manual.html
