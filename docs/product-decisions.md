# Personal family archive — owner decisions

Confirmed on 2026-11-15:

- One canonical collection contains all family branches, including disconnected
  trees. Visitors can browse and propose missing people or corrections; only
  the owner approves changes to the canonical collection.
- Public viewing requires no password and includes only people and individual
  data fields the owner explicitly approves. A public person does not imply
  permission to expose their private dates or their relatives.
- Confirmed on 2026-11-16: existing direct relationships between two public
  people may be shown automatically. A private intermediary never creates a
  public shortcut or an anonymous placeholder.
- The existing family password is known only to the owner and is intended as
  the private administrator credential. It must remain out of logs, URLs and Git.
- Confirmed on 2026-11-16: only visitors given a separate submission code may
  send suggestions. The code does not grant private viewing or owner access.
- Confirmed on 2026-11-16: approving a visual suggestion adds its new people and
  relationships to a private draft for owner inspection. A separate Save commits
  them. Approval does not grant public visibility.
- Potvrđeno 2026-11-16: osobe s kodom mogu uz prijedlog priložiti fotografije.
  One čekaju vlasnikov pregled. Vlasnik nakon odobrenja izričito bira fotografije
  i osobe za privatne galerije; glavni portret i javna vidljivost određuju se zasebno.
- Visitors choose themselves or another reference person for relationship
  explanations. Confirmed on 2026-11-16: include both recorded parent/child
  connections and spouses/partners. Public paths use only approved public people
  and their direct approved links; they cannot cross a private intermediary.
- For now this PC hosts the local application. Later it should move to the
  owner's always-on homelab so this PC can be switched off. Migration, internet
  access and production changes have not been authorized as immediate actions.
- Potvrđeno 2026-11-18: budući homelab koristi Proxmox te je dostupan u lokalnoj
  mreži i preko Tailscalea. Prvo se dovršavaju izgled i korisničke funkcije
  aplikacije. Homelabu se zasad ne pristupa; njegove podatke koristimo samo kao
  ograničenja budućeg plana preseljenja.
- Potvrđeno 2026-11-18: prvi zaslon treba imati kratak uvod i gumb za otvaranje
  stabla. Nakon pregleda vlasnik je odabrao povratak prethodne palete: tople
  svijetle podloge, zelene akcije, tamnozelena pozadina stabla i pastelne kartice.
  Novi raspored i funkcije ostaju. Pretraga i administratorska prijava dostupni
  su kroz sklopive odjeljke.
- Potvrđeno 2026-11-18: oko odabrane osobe odmah se prikazuje najbliža obitelj
  — roditelji, partneri, braća/sestre i djeca. Daljnje generacije otvaraju se
  odabirom druge osobe. Prikaz uključuje polubraću/polusestre prema postojećim
  upisanim roditeljima; javni prikaz ne prelazi preko privatnih osoba.
- Potvrđeno 2026-11-19: obitelj treba javni HTTPS pregled i prijedloge bez
  Tailscalea. Administracija, privatno stablo, Save i nadogradnje koda trebaju
  Tailscale uz ograničenje na vlasnika. Odobrena je lokalna priprema te podjele;
  pristup homelabu, promjene njegove mreže i stvarna javna objava još nisu izvršeni.

Implemented increments:

- Search across unlocked people and navigate profiles, parents, partners and
  children, including disconnected branches.
- Mobilni profil koristi donju karticu uz pregled odabrane osobe u stablu.
  Povratak na pretragu ne odbacuje neprimijenjena polja, a ponovno otvaranje
  iste osobe zadržava unos. Aktivni uređivač stabla ne preslaguje se automatski.
  Računalo zadržava popis i profil u dva stupca. Paleta boja ostaje prethodna.
- Choose a reference person in a profile and inspect one shortest recorded path
  to another person. The explanation follows recorded parent/child and partner
  links, uses neutral descriptions for complex paths and reports when no path
  is found in the visible data. Selection lasts only for this tab's session and
  changes no canonical or privacy data.
- Public landing, graph and profiles use only the reviewed public catalog.
  Saving prepares links between approved people. Privacy controls change a
  draft first, with publication review before the shared save commits it.
- Private-network HTTPS editing uses the existing password and protected local
  save API. It still requires a reachable running server.
- Local text and visual suggestions use a private filesystem queue and the
  existing validation. The owner sets, replaces or disables a separate code in
  Review, and reviews with the family password. Visual approval prepares a
  validated private draft; a separate Save commits it. Discarding the draft keeps
  approval and allows adding it again. Text is edited before Save. Explicit patch
  export remains available and nothing is automatically published.
- Confirmed on 2026-11-16: private profiles include maiden surnames, former names,
  nicknames, birthplace, residence periods, main photo, a photo gallery and free
  notes. Notes cover sources, occupations and other personal context. Photos
  are uploaded from the owner's devices and stored alongside the private tree,
  with verified copies included in backup/restore. These fields are private.
- Fotografije uz tekstualne i vizualne dopune čuvaju se privatno uz prijedlog.
  Pregled i preuzimanje zahtijevaju obiteljsku lozinku. Odabrani prilozi dodaju se
  u galerije kroz nacrt i Save, uz očuvanje izvornih bajtova i postojećih izmjena.
- Korak od 2026-11-18: lokalni javni profil nudi **Predloži ispravak** osobama s
  kodom. Polja su prazna i ne otkrivaju privatni profil. Vlasnik uspoređuje
  sadašnje i predložene vrijednosti, bira polja za nacrt pa zasebno sprema.
  Bilješke i mjesta života dodaju se postojećima; ispravak ne mijenja odnose,
  identifikatore, fotografije ni javnu vidljivost. Nakon nove spremljene inačice
  staro odobrenje zahtijeva ponovni pregled prije ponovnog dodavanja.

- Jednostavnije dodavanje od 2026-11-19: vlasnik iz profila dodaje roditelja,
  partnera, brata/sestru ili dijete, kao novi ili postojeći zapis. Pretraga
  nudi dodavanje nepovezane osobe/grane. Nove su osobe privatne; jednaka imena
  zahtijevaju izbor postojećeg zapisa ili potvrdu zasebne osobe. Zajednički
  roditelji i drugi roditelj djeteta biraju se izričito. Nacrt i postojeći Save
  ostaju jedini postupak spremanja, uz provjeru obostranih veza, najviše dva
  roditelja i odsutnosti krugova u roditeljskim vezama.

Remaining integration decisions:

- The static production suggestion-review service still requires Cognito.
  The local queue and deployed AWS queue are separate. No deployment, cloud
  authentication change or queue transfer has been performed. A future homelab
  move must preserve private media and the local suggestion queue alongside the
  canonical collection.
- Public fields remain explicitly chosen by the owner; only the direct links
  between approved public people are automatic. Preparing public artifacts
  continues to require a password-backed, reviewed owner Save.

- Homelab način pripremljen je s javnim i privatnim loopback ulazom koji dijele
  postojeći postupak spremanja. Tailscale Serve/Funnel, prava SSH pristupa,
  automatsko pokretanje servisa i prijenos stvarnih podataka ostaju za zasebno
  postavljanje na odredištu prema `docs/homelab.md`.
