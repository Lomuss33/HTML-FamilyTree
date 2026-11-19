# Priprema homelaba: javni pregled, privatna administracija

Ovo su pripremljeni kod i koraci za kasnije postavljanje. Homelabu se tijekom
pripreme nije pristupalo; Tailscale, SSH, Proxmox i javna objava nisu mijenjani.

Za vlasnika koji još nema zaseban gost početak je u
[prvim koracima za homelab](homelab-first-steps.md): najprije samo pregled
slobodnih resursa i izbor administratorskih uređaja, zatim priprema odvojenog gosta.

## Dva ulaza, jedna zbirka i jedan Save

`npm run homelab` pokreće jednu aplikaciju s dva HTTP ulaza vezana isključivo
na `127.0.0.1`. HTTPS završava u zasebnim posrednicima na istom stroju.

| Ulaz | Primjer | Dostupno |
| --- | --- | --- |
| Javni | `https://family.example-tailnet.ts.net` | Odobreni katalog, javni prikaz i slanje prijedloga uz zasebni kod |
| Privatni | `https://family.example-tailnet.ts.net:8443` | Postojeća lozinka, privatno stablo, fotografije, uređivanje, Save i pregled prijedloga |
| Održavanje | SSH preko Tailscalea | Ručne nadogradnje koda, kopije i održavanje |

Javni ulaz dopušta samo statičke datoteke s postojećeg odobrenog popisa,
**bez `data/family.enc.json`**, te ove tri API operacije:

- `GET /api/public-status` — samo dostupnost slanja i podržanih vrsta prijedloga;
- `POST /api/suggestions` — tekstualni, vizualni i profilni prijedlozi uz kod;
- `POST /api/suggestions/photos` — prilaganje fotografija uz kod.

Sve druge javne API putanje odbijaju se i uz valjanu administratorsku lozinku
ili CSRF token. Nema javnog čitanja prijedloga ili njihovih fotografija.
Javni obrazac za administratorsku prijavu skriven je; zaštitu provodi poslužitelj.
Privatni ulaz zadržava provjere lozinke, Host/Origin zaglavlja, CSRF tokena,
veličine zahtjeva i sukoba spremljenih inačica. Proslijeđena zaglavlja
`X-Forwarded-*` i `Tailscale-User-*` ne daju administratorske ovlasti.

Uspješan Save osvježava oba prikaza zajedno, koristeći postojeći pregled javnih
promjena. Javni posjetitelj dobiva novu inačicu pri sljedećem učitavanju stranice.
Neuspjeli Save zadržava prethodne datoteke i nacrt. Nadogradnja programskog koda
ostaje zasebna radnja; aplikacija nema javni API za instalaciju koda.

## Prijenos i lokalna konfiguracija

Na Proxmoxu predvidjeti zaseban Linux VM ili neprivilegirani LXC s Node.js 22+
i Tailscaleom. Proces aplikacije treba raditi kao običan korisnik, odvojen od
administracije Proxmoxa. Stvarna instalacija i pristup stroju slijede zasebno.

Prije prijenosa zaustaviti upise i napraviti provjerenu kopiju postojećim
postupkom `npm run backup`. Sačuvati cijelu mapu `private/`, uključujući
fotografije, prijedloge, postavke njihova koda, povijest i sigurnosne kopije,
te pripadajuće četiri pripremljene datoteke iz `data/` i `api/generated/`.
Na odredištu provjeriti kontrolne zbrojeve i oporavak na izdvojenoj kopiji.
Privatne datoteke prenositi šifriranom vezom; ne dodavati ih u Git ili javni paket.

Kopirati `config/homelab.example.json` u Gitom zanemareni
`config/homelab.local.json`. Zamijeniti oba izmišljena naziva stvarnim nazivom
Tailscale uređaja. Oba `Origin` unosa moraju biti točne HTTPS adrese bez završne
kose crte; moraju se razlikovati. Lokalni portovi također se moraju razlikovati.
Konfiguracija ne sadrži obiteljsku lozinku ni kod za prijedloge.

```json
{
  "publicOrigin": "https://family.example-tailnet.ts.net",
  "privateOrigin": "https://family.example-tailnet.ts.net:8443",
  "publicPort": 4180,
  "privatePort": 4181
}
```

```sh
npm ci
npm run verify
npm run homelab
```

Podržana je i naredba `npm run homelab -- --config <datoteka>` te `--root <mapa>`.
Naredbe rade i na Windowsu; putanje s razmacima staviti u navodnike u ljusci.
Pokretač odbija neispravnu konfiguraciju, a ako drugi port nije slobodan zatvara
prvi ulaz. Homelab način zanemaruje AWS konfiguraciju i koristi postojeći lokalni
red prijedloga. Nije potrebno uvoditi nove AWS resurse niti mijenjati šifriranje.

## HTTPS i Tailscale — primijeniti tek pri postavljanju

Najprije pregledati postojeća pravila pristupa i `tailscale serve status` /
`tailscale funnel status`. Predložene naredbe mijenjaju konfiguraciju uređaja;
nisu izvršene tijekom pripreme. Ne zamjenjivati postojeća pravila cijele mreže.

Privatni HTTPS ulaz prvo usmjeriti na privatni lokalni port:

```sh
tailscale serve --bg --https=8443 http://127.0.0.1:4181
```

Tailscale pravilima dopustiti pristup portu `8443` i SSH-u na ovom uređaju samo
vlasnikovom identitetu i odobrenim uređajima. Samo članstvo u Tailscale mreži
nije dovoljno ograničenje ako postoje široka pravila pristupa. Postojeća
obiteljska lozinka ostaje potrebna i nakon spajanja na privatni web-ulaz.
SSH ograničiti na Tailscale mrežu; ne otvarati ga na usmjerivaču prema internetu.
Upravljanje Proxmoxom također ne izlagati javno.

Tek nakon privatne provjere javni HTTPS usmjeriti isključivo na javni lokalni port:

```sh
tailscale funnel --bg --https=443 http://127.0.0.1:4180
```

Port `443` tada je javan, dok `8443` ostaje u Serveu. **Ne uključivati Funnel
za administratorski port.** Serve i Funnel ne mogu imati različitu vidljivost
na istom HTTPS portu. Oba posrednika moraju sačuvati izvorni `Host` i `Origin`.
Ne usmjeravati Funnel na port `4181`, obični `npm run local`, cijeli repozitorij
ili direktorij `dist/`: postojeći paket za GitHub Pages i dalje uključuje
šifriranu privatnu datoteku radi kompatibilnosti. Nova podjela vrijedi za
homelab poslužitelj; ne mijenja prethodno objavljene kopije ni postavke Pagesa.

Ovaj raspored koristi Tailscaleov naziv `*.ts.net`. Vlastita domena i drugi javni
posrednik mogu se odabrati naknadno. Postojeći limit za prijedloge iza lokalnog
posrednika konzervativno se dijeli među posjetiteljima: 30 zahtjeva u minuti,
uključujući prilaganje fotografija. Ne vjerujemo proizvoljnom `X-Forwarded-For`.

Službene upute provjerene za ovu pripremu:
[Serve](https://tailscale.com/docs/features/tailscale-serve),
[Serve CLI](https://tailscale.com/docs/reference/tailscale-cli/serve),
[Funnel CLI](https://tailscale.com/docs/reference/tailscale-cli/funnel),
[SSH](https://tailscale.com/docs/features/tailscale-ssh).

## Provjera prije stvarne uporabe

Na izdvojenom izmišljenom stablu provjeriti javni link s mobitela na mobilnom
internetu, s isključenim Tailscaleom: pregled i slanje uz kod trebaju raditi;
`/data/family.enc.json`, `/api/status`, `/api/session`, `/api/save`,
`/api/admin/suggestions/list` i privatne datoteke ne smiju biti dostupni.
Privatni port `8443` i SSH ne smiju dopuštati vanjski pristup.

Zatim s odobrenog uređaja kroz Tailscale provjeriti privatnu prijavu, pregled
primljenog prijedloga, Save i ponovno otvaranje. Provjeriti da odobrena javna
izmjena stiže na javni prikaz, a privatna polja i fotografije ostaju privatni.
Neodobreni Tailscale uređaj također ne smije moći administrirati aplikaciju.

Lokalni testovi `test/homelab-access.test.mjs` i
`test/browser/homelab-access.spec.mjs` koriste samo izmišljene podatke.
Testovi preglednika prolaze kroz dva stvarna lokalna HTTPS posrednika i DNS naziv.
Ne dokazuju ispravnost budućih Tailscale pravila, vanjske mreže ili Proxmoxa.

Nakon postavljanja aplikaciju pokretati servisom pri podizanju sustava, uz
radnu mapu repozitorija, običnog korisnika i `umask 0077`. Prije nadogradnje
preko Tailscale SSH-a zaustaviti servis, provjeriti sigurnosnu kopiju, ažurirati
samo programske datoteke i pokrenuti provjere. Sačuvati `private/`, pripremljene
obiteljske datoteke i lokalnu konfiguraciju. Zatim ponovno pokrenuti servis
i provjeriti oba ulaza. Nadogradnje se ne preuzimaju ili objavljuju automatski.
