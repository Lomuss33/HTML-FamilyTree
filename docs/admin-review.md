# Authenticated Administrator Review

## Local application

The protected `npm run dev` server reviews a local private queue using the family
password. Open **Review** after unlocking, then **Kod za slanje prijedloga** to set
or rotate a separate guest code. Disabling guest submissions preserves all records.
The code permits submission only. Guests cannot list, read or review the queue.

The browser uses local `POST /api/suggestions` for code-protected submission and
`POST /api/admin/suggestions/{list,get,review,draft,photo,photo-draft,settings}` for owner actions. Owner
requests require the exact origin, CSRF token and verified family password. Guest
requests require the exact origin, JSON, a valid code, a 64 KB proposal maximum and the
per-address attempt limit. There is no CORS access. The local adapter reuses the
cloud service's submission validation, safe response projection and stale graph
checks; it makes no AWS calls. Local discovery failure does not enable a cloud
fallback.

Local review additionally checks the version fetched with each selected record.
If another tab saves a decision first, reload before reviewing. A failed write
keeps the previous record. If a response is interrupted, reload the record to see
whether the decision was saved before retrying. Reviewed records and code settings
have verified previous copies in ignored `private/suggestions/history/`; restore a
chosen copy only while the server is stopped, after privately checking its record
id and retaining the current file. Orphan `write-*` temporary files are ignored.
The integration tests exercise obstruction before replacement, retry and restart.

Queue files and history are private plaintext under `private/suggestions/`. Copy
that entire directory as part of private machine backups or a homelab move; the
family tree backup command covers the tree and its media, not this separate queue.
Queue records are not automatically deleted. **Odobri i dodaj u nacrt** records
approval and returns a validated private draft. The server uses the existing
additions validator against the complete canonical tree while holding its writer
lock; this catches conflicts such as an anchor already having two parents. The
request must match both the selected review version and the unlocked full snapshot,
so even a newer display-only edit prevents overwriting a stale browser's base.
Only the later **Save** replaces the five family artifacts. New people are private
and public visibility still requires the owner's separate explicit choice.

Save or discard other edits before adding a proposal. A failed Save retains its
draft. Discard, confirmed Lock and reload can discard it without reversing the
approval. The accepted record's **Dodaj u nacrt** action returns the same validated
candidate without writing another review decision. A lost approval response is
recovered by refreshing the accepted list; responses arriving after Lock cannot
restore private data or stage changes. A stale or already applied proposal cannot
duplicate saved people. Explicit patch download remains available for export.
Slobodne tekstualne poruke i dalje se obrađuju ručno kroz uređivač i Save.

### Prijedlog ispravka podataka o osobi

Lokalna aplikacija u javnom profilu nudi **Predloži ispravak** kada vlasnik uključi
slanje kodom. Posjetitelj vidi samo odobrenu javnu oznaku osobe, a predložena
polja počinju prazna. Označava podatke koje želi poslati; obrazac ne dohvaća
privatni profil. Prije slanja osvježava se javni katalog. Ako osoba više nije
javna, slanje se zaustavlja uz očuvanje unosa. Neuspjelo slanje također zadržava
polja, a kod je potrebno ponovno upisati.

Lokalni zapis koristi postojeći tip `text` uz strogo provjereni `profileChange`.
Kod se provjerava prije provjere pripada li osoba javnom popisu. Dopuštena su
samo profilna tekstualna polja i zapisi mjesta života. Prazna vrijednost ne može
izbrisati podatak. Identifikatori, veze, privatnost, javne oznake i postojeće
fotografije nisu dio ispravka. Fotografije se mogu priložiti zasebno, uz isti kod
i postojeći postupak pregleda priloga.

Vlasnik u **Review** vidi sadašnje i predložene vrijednosti te označava polja koja
prihvaća. Bilješke se dopisuju, a mjesta života dodaju bez uklanjanja prethodnih
zapisa. Ostala odabrana polja predlažu zamjenu. **Odobri i dodaj u nacrt** provjerava
trenutačnu inačicu pregleda i cijelog stabla te priprema samo odabrane promjene.
Tek odvojeni **Save** mijenja obiteljske datoteke. Neodabrana polja i javna
vidljivost ostaju nepromijenjeni. Ako su svi odabrani podaci već upisani, prikazuje
se ta poruka bez stvaranja lažnog nespremljenog nacrta.

Odobrenje pamti odabrana polja i točnu početnu inačicu stabla. Nakon odbacivanja
nacrta moguće je ponovno **Dodaj u nacrt**, dok god nije spremljena nova inačica.
Nakon novog spremanja potrebno je vratiti prijedlog na čekanje i ponovno ga
pregledati. Tako staro odobrenje ne može poništiti naknadni ispravak vlasnika.
Prikaz privatne usporedbe briše se zaključavanjem. Ovaj obrazac i primjena
ispravaka zasad su lokalni; objavljeni AWS ugovor i infrastruktura nisu mijenjani.

### Pregled priloženih fotografija

`POST /api/suggestions/photos` prihvaća fotografiju uz isti kod za prijedloge,
provjeru izvora zahtjeva, vrste i veličine datoteke te zajedničko ograničenje
broja pokušaja. Najviše šest priloga može pripadati jednom prijedlogu, do 8 MB
po fotografiji. Za dovršavanje prijedloga koriste se nasumične oznake učitavanja;
posjetitelj ne može proizvoljno dodati poznatu oznaku privatne fotografije.
Oznake učitavanja i kod ne ulaze u spremljeni prijedlog.

Podaci i izvornici čekaju u privatnoj mapi prijedloga. Za čitanje je potrebna
prijava vlasnika, a fotografija mora pripadati traženom prijedlogu. Obični HTTP
pristup privatnim putovima ostaje zabranjen. Pregled prikazuje umanjenu sliku,
a preuzimanje zadržava izvorne bajtove uz siguran nastavak datoteke.

Tek odobren prijedlog omogućuje izričit odabir fotografije i osobe za galeriju.
`photo-draft` provjerava inačicu pregleda i stabla te valjanost trenutnog nacrta.
Provjerene se fotografije kopiraju bez prepisivanja postojećih datoteka, a nacrt
zadržava ostale izmjene. Aplikacija odbija zakašnjeli odgovor nakon Locka ili
naknadne promjene nacrta. Tek Save sprema obiteljske datoteke. Glavna fotografija
i javna vidljivost ostaju zasebni izbori vlasnika.

Prilozi i nedovršena učitavanja ostaju sačuvani u `private/suggestions/`, koji
treba u cijelosti obuhvatiti privatnom sigurnosnom kopijom. Neodobreni se prilozi
ne kopiraju u aktivnu mapu fotografija stabla niti u javni paket.

The rest of this document describes the existing deployed AWS service. Its queue,
Cognito authorization and deployment are unchanged and separate from local review.

## Security boundary

Administrator review uses a dedicated Amazon Cognito user pool. It does not
reuse the family-tree password or guest submission access code. The browser is
a public OAuth client with no client secret and uses authorization code with
PKCE, `state`, and `nonce`.

The Cognito user pool is administrator-create-only and requires TOTP MFA. The
static frontend stores the short-lived 15-minute access and ID tokens only in
`sessionStorage`; it deliberately discards refresh tokens. Locking the family
tree clears the local admin session. Explicit sign-out also ends the Cognito
hosted-UI session.

API Gateway validates JWT signature, issuer, audience/client id, expiry, and
the `openid` scope before invoking the admin Lambda. The Lambda additionally
requires `token_use=access`, the configured client id, and a subject claim.

## Routes and permissions

- `POST /suggestions` remains public apart from its existing submission-code check.
- `GET /admin/suggestions` queries the status/created-time index with bounded pagination.
- `GET /admin/suggestions/{id}` retrieves one explicit suggestion id.
- `PATCH /admin/suggestions/{id}` sets `pending`, `accepted`, or `rejected` and an optional note.

The public Lambda can only call DynamoDB `PutItem`. The admin Lambda can only
call `GetItem`, `Query` on `status-createdAt-index`, and `UpdateItem`. Neither
Lambda can scan or delete the table, and neither can access the canonical tree.
Responses are projected through explicit field allowlists so legacy secrets or
unexpected DynamoDB attributes are never returned.

## Review UI

The Review button appears only after the encrypted family tree has been
unlocked. Cognito authentication is still required inside the panel. The side
rail supports status/type filters, bounded pagination, submitter/date/status
summaries, and explicit detail retrieval.

Graph records have three non-mutating visual modes:

- Original: the canonical anchor and its one-hop relationships.
- Suggestion: the anchor plus proposed temporary people.
- Overlay: canonical one-hop context plus proposed additions.

Original, Anchor, and Proposed cards use text badges and distinct border
treatments, not color alone. Rendering is performed from cloned adapters;
Family Chart remains a layout engine and never becomes review state.

## Stale revisions and acceptance

The admin Lambda package includes `api/generated/canonical-revision.json`.
Accepting a graph is rejected with HTTP 409 unless both the stored
`anchorCatalogVersion` and `sourceRevision` equal that deployed artifact.
Text acceptance does not require a graph revision.

The browser refreshes public revision metadata before acceptance and patch
download. Unsaved local changes block acceptance. Download patch again retries
the deterministic export without sending another status update. Lock clears
suggestion details and invalidates pending UI requests.

The browser independently compares the suggestion with the current public
catalog metadata and produces a deterministic patch with this shape:

```json
{
  "schemaVersion": 1,
  "type": "family-additions",
  "suggestionId": "server-generated-id",
  "anchorPersonId": "canonical-anchor",
  "anchorCatalogVersion": "sha256:...",
  "sourceRevision": "sha256:...",
  "addPeople": [],
  "addRelationships": []
}
```

Temporary ids are deterministically mapped to `sg_<suggestion>_<number>` ids.
The schema has no delete, update, replace, detach, or arbitrary patch fields.

## Local patch application

Always inspect the downloaded JSON first. A dry run performs validation only:

```bash
npm run apply:additions -- --patch /path/to/patch.json --dry-run
```

To apply and regenerate all artifacts:

```bash
FAMILY_TREE_PASSWORD='local-password' \
  npm run apply:additions -- --patch /path/to/patch.json
```

The script:

1. validates the current private family;
2. checks catalog and source revisions;
3. rejects temporary, duplicate, disconnected, mutation-like, and
   canonical-to-canonical operations;
4. creates reciprocal parent/child or spouse arrays in memory;
5. validates cycles, parent counts, ids, and all canonical invariants;
6. generates candidate encrypted/catalog/allowlist/revision artifacts in a
   temporary directory;
7. writes verified recovery copies under ignored `private/transactions/`;
8. replaces and verifies all five artifacts, or restores the previous set.

The script does not commit, push, upload, or call AWS.

## Creating the first administrator

After confirming the project's assigned Region in AWS Settings, create an
application administrator in the deployed Cognito user pool. This is separate
from AWS project team-member access. Substitute the confirmed Region:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username YOUR_EMAIL \
  --user-attributes Name=email,Value=YOUR_EMAIL Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --region YOUR_CONFIRMED_PROJECT_REGION \
  --profile familytree-prod
```

The invitation contains a temporary password. On first hosted-UI sign-in,
Cognito requires a new strong password and TOTP setup. No administrator user or
password is stored in CloudFormation or repository files.
