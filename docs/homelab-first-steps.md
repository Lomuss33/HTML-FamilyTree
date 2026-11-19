# Vlasnikov prvi korak za homelab

Ovo su upute za pripremu vlasnika. Ne stvaraju VM/LXC, ne instaliraju programe
i ne mijenjaju Proxmox, Tailscale ili postojeće servise. Stvarne mrežne adrese,
identiteti, lozinke i ključevi nisu dio ovog dokumenta.

## Polazište

Vlasnik ima Proxmox i postojeću Tailscale mrežu s više uređaja i servisa.
Zaseban gost za obiteljsko stablo još nije pripremljen. Aplikaciju planiramo
odvojiti od Proxmox hosta i postojećih servisa. Git kopija sadrži kod i ranije
odobrene artefakte, ali ne sadrži aktualni privatni izvor, fotografije ni lokalni
red prijedloga. Njihov će prijenos biti zaseban, zaštićen korak.

## Sada samo prikupi ove podatke

1. Otvori postojeći Proxmox web-prikaz i odaberi čvor u lijevom stupcu.
2. Na kartici **Summary** zabilježi ukupni i trenutačno zauzeti RAM te procesor.
3. Odaberi spremište namijenjeno virtualnim strojevima i zabilježi slobodan prostor.
4. Zabilježi verziju Proxmoxa i postoji li već planirano mjesto za sigurnosne kopije.

Za sljedeći korak dovoljno je javiti ove obične tehničke podatke. Nisu potrebni
prijavni podaci, promjena postojećih servisa ni otvaranje portova.

## Predloženi odvojeni gost

Ako raspoloživi resursi dopuštaju, početna preporuka je zasebna Linux VM.
Tailscale se u njezinu operacijskom sustavu instalira uobičajeno. Neprivilegirani
LXC također je moguć i lakši je za resurse, ali za uobičajeni Tailscale način
treba omogućiti `/dev/net/tun`. Zato VM zasad smanjuje posebne postavke kontejnera.
To je prijedlog, a ne odluka ili već izvršena instalacija.

Početna procjena za malu zbirku je **2 vCPU, 2 GB RAM-a i 20 GB diska**, uz
dodatni prostor za izvorne fotografije i kopije. To nije izmjeren minimalni
zahtjev; veličinu potvrđujemo prema slobodnim resursima i planiranim medijima.
Verziju podržanog Linuxa i način instalacije Node.js 22+ odabiremo nakon toga.
GitHub provjere testiraju aplikaciju na Node.js 22 i 24.

## Tailscale pristup

Zaseban gost treba vlastiti Tailscale pristup za administraciju aplikacije.
Postojeći pristup Proxmoxu nije isto što i zasebno zaštićen ulaz u aplikaciju.
Ako više uređaja pripada istom Tailscale identitetu, pravilo za taj identitet
ne izdvaja samo računalo namijenjeno administraciji. Vlasnik prvo odabire
administratorske uređaje, a tek nakon pregleda postojećih Access controls pravila
pripremamo odgovarajuće ograničenje. Široka postojeća pravila mogu dopuštati više
pristupa nego što dopušta novo usko pravilo; ne zamjenjivati cijelu postojeću politiku.

Javni pregled namijenjen je običnom HTTPS linku. Administratorski web-pristup,
SSH i nadogradnje koda ostaju na privatnom ulazu. Proxmox administracija nije
dio javne stranice. Detaljna podjela portova nalazi se u `docs/homelab.md`.

## Nakon provjere resursa, korak po korak

1. Vlasnik priprema zaseban Linux gost i njegovo automatsko pokretanje.
2. Pripremamo privatni Tailscale pristup i odabir administratorskih uređaja.
3. Preuzimamo točno pregledani kod iz grane `prep/personal-archive-stabilization`.
4. Najprije provjeravamo aplikaciju na izmišljenim podacima, zatim prenosimo
   provjerenu kopiju stvarne zbirke, medija, prijedloga i pripremljenih artefakata.
5. Provjeravamo privatnu prijavu, Save, oporavak i nedostupnost administracije
   s neodobrenog uređaja. Zasebno pripremamo trajni servis i sigurnosne kopije.
6. Tek na kraju vlasnik odobrava javni ulaz i provjerava ga s isključenim Tailscaleom.

Aktualne službene upute:
[Proxmox sučelje](https://pve.proxmox.com/pve-docs/chapter-pve-gui.html),
[Tailscale na Proxmoxu i u VM-u](https://tailscale.com/docs/reference/troubleshooting/containers/proxmox),
[Tailscale u neprivilegiranom LXC-u](https://tailscale.com/docs/features/containers/lxc/lxc-unprivileged),
[Tailscale pravila pristupa](https://tailscale.com/docs/features/access-control).
