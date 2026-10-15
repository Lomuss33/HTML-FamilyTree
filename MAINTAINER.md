# Maintainer guide

## Daily use

Run `npm run dev` (`npm run local` also works) and open http://127.0.0.1:4173.
Unlock, Edit, then click the page-level Save. It also applies unfinished fields in the current card. You can
still Submit individual cards while working. Publication changes show their exact labels
for approval. One verified transaction replaces all five family artifacts.

The local server binds to loopback and serves only the approved site files. It
requires its process token, exact Origin/Host, JSON, and a current snapshot for
writes. Keep it bound to loopback.

The saved snapshot and working draft are separate. Navigating the chart does not
change saved data. Refresh/Lock clears readable family data. Unsaved changes
prompt before discard, lock, or leaving the page, including unfinished card fields.
Cancelling a card or navigating to another card also checks those fields first.
Download draft applies unfinished fields and exports plaintext
only when you explicitly choose it; store that file securely.
The default downloaded filename and browser-numbered copies are ignored by Git;
validation also rejects them if they were forcibly tracked. Renaming a plaintext
export does not make it safe to commit.

If a save response is interrupted, **Check save** looks up the original operation
receipt before retrying. A successful receipt means the disk commit completed.
A stale-snapshot error keeps the draft; download it, lock/unlock, and reconcile
against the current saved tree.

## First unlock after this repair

The old local source was backed up and moved to `private/family.json`. Only
absent relationship arrays and explicit privacy metadata for the existing 15
catalog entries were added. The public catalog labels were preserved exactly.

The old ciphertext has deliberately not been replaced without the password.
Unlock in the protected local app and click Save when it offers preparation.
Then prepare the release locally. Until that happens, full real-data decryption
and release readiness remain pending.

Migration for another legacy checkout:

```powershell
npm run migrate -- --dry-run --keep-existing-anchors
npm run migrate -- --keep-existing-anchors
```

Use `--keep-existing-anchors` only after deciding to retain every existing public
catalog label. Without that option, migration does not infer opt-ins. Conflicting
modern and legacy sources stop writes. Migration copies are under ignored
`private/backups/` with verified inventories.

## Manual changes and public labels

Edit `private/family.json`. Keep all three relationship arrays, stable IDs,
reciprocal relationships, at most two parents, and no ancestry cycles.

```powershell
npm run prepare -- --review-publication --dry-run
.\scripts\family-maintenance.ps1 prepare
```

If public labels changed, inspect `private/reviews/` and explicitly approve:

```powershell
.\scripts\family-maintenance.ps1 prepare --approve-publication
```

The complete artifact set is validated, encrypted and decrypted in memory before
replacement. Transaction backups are retained locally. Preparation can reconcile
a deliberately edited source, while browser saves require a matching unlocked
snapshot. Separate `--input` / `--output` and `--password` arguments are no longer
supported by encryption or public generation.

`enable:all-anchors` is an exceptional bulk-publication command. Its dry run
proposes names/birthdays for every person. Review the private preview and supply
`--approve-publication` only if that is the intended publication decision.

## Password rotation

```powershell
.\scripts\family-maintenance.ps1 prepare --rotate-password
```

Enter the current password, then the new password. The transaction preserves the
tree and verifies encryption under the new password before replacement. Prepare
and publish a new release. People who already downloaded/decrypted an older
version can retain it; rotation does not revoke old copies.

In other shells, use `FAMILY_TREE_PASSWORD` and `FAMILY_TREE_NEW_PASSWORD` locally.
The Windows wrapper restores prior environment values when it exits. It never
prints the entered passwords.

## Backup and restore

Create an encrypted backup, verify it, and copy it to another secure location:

```powershell
.\scripts\family-maintenance.ps1 backup
```

The command reports the backup path and digest without listing people.
Migration/transaction recovery directories also contain plaintext and require
the same computer/disk protection as the canonical source. They are ignored,
never published, and retained until you deliberately archive or remove them
after confirming a separate backup works.

To inspect/decrypt a backup without changing live files:

```powershell
.\scripts\family-maintenance.ps1 restore --backup C:\secure\family.enc.json --dry-run
```

To restore into an existing edition, remove `--dry-run`. The current family
password authenticates replacement. If the backup password differs, supply
`FAMILY_TREE_BACKUP_PASSWORD` locally as well. Public label changes require
`--approve-publication` after review.

For an isolated recovery rehearsal, create an empty folder and run:

```powershell
New-Item -ItemType Directory C:\secure\family-restore-rehearsal
.\scripts\family-maintenance.ps1 restore --root C:\secure\family-restore-rehearsal --backup C:\secure\family.enc.json --initialize --approve-publication
```

Empty initialization refuses any existing family artifacts. It recreates the
five files and verifies decryption; it does not copy application code. Compare
the restored tree privately before restoring over a live edition.

## Interrupted operations

```powershell
npm run recover -- --inspect
npm run recover
```

Startup also attempts recovery. A prepared/replacing transaction restores its
verified old set. A preparation interrupted before replacement is abandoned.
An uncertain or unverifiable recovery blocks further writes. Keep
`private/transactions/` intact; do not delete a journal to bypass a block.

Recovery verifies the complete backup set before replacing any file. If a
backup is corrupt or a current file contains manual rescue edits outside the
recorded before/after states, recovery stops without overwriting that set.
Preserve the manual copy and inspect the verified recovery files before making
a deliberate local resolution.

A writer lock is cleared automatically only when its recorded process no longer
exists. An uncertain/live lock needs local inspection. Stop the owning process
before retrying; never delete a live lock to force concurrent writes.

If an interrupted migration leaves both old and new source paths, use the
verified migration backup and inventory to determine the intended source before
removing either file. Automatic save recovery does not silently choose between
conflicting canonical sources.

## New personal fork

Start with a separate clone and no private source. Create ignored `private/` and
copy `data/family.template.json` to `private/family.json`. Replace the fictional
people and review privacy opt-ins.

```powershell
.\scripts\family-maintenance.ps1 prepare --initialize --approve-publication
```

Initialization is an explicit first-password operation for that new fork; do not
use it to rotate an established family's password. It keeps the old artifact set
in ignored transaction storage. For an entirely empty data-only restore target,
use the restore initialization described above.

## Configuration and optional AWS

Source `assets/site-config.js` contains disabled defaults. The builder generates
the published configuration from `config/production.json` or ignored
`config/local.json`. Only public URLs and the OAuth client identifier are allowed.
A client secret, family password, or guest access code must never be added.

Review local endpoints before enabling suggestions/review. Local mode does not
silently send fictional testing data to the production API. Cognito callback
and logout URLs must match the intended deployed site.

When graph topology or public labels change, the optional API package needs the
matching `api/generated/` files. Deploy the backend pair in coordination with the
Pages release; stale revision checks reject mismatches. Website publication
does not deploy AWS resources.

Before any AWS deployment, confirm the assigned Region at **AWS Settings →
View all projects → Overview → Additional Info → Region**, and plan/spend status
at **AWS Settings → Billing**. Regional resources belong only in that selected
Region. This repair created no cloud resources.

## Verification and publication

```powershell
npm run verify
.\scripts\family-maintenance.ps1 release:prepare
```

`verify` is one consolidated syntax/test/validation/build pass with fictional
fixtures. It explicitly reports that decryption was not checked when no family
password is available. CI checks Windows/Ubuntu with Node 22/24; a clean checkout
validates the fictional template and artifact schemas without production data.

A separate, four-case browser smoke suite runs on Chromium in CI. It checks
unfinished-card Save/Lock, lost-response receipt recovery, stale-tab draft
downloads, and a 390 px repository-path layout. Unexpected external requests are
blocked. These browser tools are development dependencies; they do not ship in
the website or require a paid hosting service.

To run that suite yourself:

```powershell
npx playwright install chromium
npm run test:browser
```

The runner starts its own fictional server on port 4175 and refuses to reuse an
existing process. Interactive agent checks use the T3 collaborative preview.
See [Playwright configuration](https://playwright.dev/docs/test-configuration).

`release:prepare` additionally requires the real local source and password. It
assembles production `dist/`, decrypts its payload, compares the complete source,
and writes `config/publication.json`. This receipt contains a digest of the exact
public files, no private tree revision or password. Any public code, data, or
runtime-config change requires preparing it again.

Review Git changes and the catalog, commit the release receipt and generated
artifacts, then run the manual **Publish personal edition** workflow on main.
Only `dist/` is uploaded. Select GitHub Actions as the Pages source; publishing
directly from the repository root bypasses the manifest protection.

The workflow follows [GitHub's custom Pages workflow documentation](https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages).
Publication first calls the reusable Verify workflow, including its browser job,
and then checks the locally verified release digest. See
[GitHub reusable workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows).

Public text is assembled with LF line endings so Windows and Linux produce the
same release digest. This does not rewrite source files or decrypt/re-encrypt
the original envelope. Local unlock fingerprints use the same public bytes;
older migration receipts remain bound to their original source-file digest.
Live cloud access, OAuth callbacks, and the final deployed URL still need a
post-deployment check when you choose to release.

Keep the vendored [security patches](docs/vendor-patches.md) when updating the
chart library. Keep real names out of test fixtures, screenshots, and tracked
documents.
