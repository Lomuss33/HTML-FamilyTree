# Stabilization verification — 2026-10-14–15

This pass started on `main` at `d5dc772` with substantial existing, uncommitted
repairs. Those changes were preserved and tested. No commit, push, deployment,
AWS call, password rotation on real data, or hosting-setting change was made.

1. **Confirmed problems and diagnosis.** The current source is
   `private/family.json`; the legacy live source is absent. It validates with
   zero missing relationship arrays. Its 15 opt-ins exactly match the public
   catalog: zero added, removed, or changed labels, and matching topology
   revision. A verified historical backup confirms the reported 22 missing
   arrays and zero original opt-ins. After adding only absent arrays in memory,
   all other fields and ordering match the current source when privacy metadata
   is excluded. Earlier reconciliation therefore predates this pass; this is
   not a new publication-consent decision.

   Existing repairs already close repository-file serving and invalid write
   requests, share the five-file save workflow, separate local configuration,
   and avoid spawning `npm` during patch application. Real HTTP and Windows CLI
   tests confirm those behaviors. The old diagnosis is not the current state.

2. **Implemented repairs in this pass.**

   | Confirmed defect | Focused repair |
   | --- | --- |
   | Editor export turned `null` relationships into empty arrays | `assets/viewer/editor-state.js` fills only absent arrays and rejects malformed values without mutating its input. |
   | Applying an addition sorted unrelated existing relationships | `scripts/apply-family-additions.mjs` appends the additions and preserves existing ordering and fields. |
   | Recovery replaced early files before discovering a corrupt later backup | `scripts/lib/file-transaction.mjs` verifies every recovery copy before replacing anything. |
   | Restart recovery overwrote manual edits made after an interruption | Recovery checks current bytes against the recorded old/new digests and blocks on unknown changes. |
   | Administrator storage errors escaped into family unlock/lock | `assets/admin/auth-client.js` treats unavailable storage as signed out and keeps Lock effective; review initialization logs only a fixed message. |
   | CLI errors and HTTP validation details exposed private identifiers/parser snippets | `scripts/lib/project-paths.mjs` provides redacted diagnostics; maintenance CLIs use them, and save errors return issue counts. Detailed validator values remain in memory. |
   | A maintenance save left the running server serving old ciphertext | `scripts/local-server.mjs` refreshes the served artifact at discovery; `assets/app.js` discovers before a fresh unlock. |
   | Checking an unfinished save could lose its original operation identifier | `assets/app.js` retains pending operations on in-progress receipts and writer contention, then resolves the committed receipt. |

   No new transaction framework, database, frontend framework, encryption format,
   cloud infrastructure, or chart-library replacement was introduced.

3. **Preserved behavior.** Version-1 PBKDF2/SHA-256/AES-GCM envelopes still
   round-trip between Node and Web Crypto. Browser decryption, chart editing,
   unfinished-card Save, Discard, Lock, draft export, additions-only patches,
   public anchors, suggestion contracts, and Cognito PKCE remain compatible.
   Generated catalog/backend revisions are checked together. The publication
   artifact retains relative URLs and contains exactly 25 approved files.

4. **Verification.** `npm run verify` passed on Windows / Node 24.11.1:
   75 modules passed syntax checks; all 169 Node/API tests passed with no skips;
   source/public validation, local build, and output validation passed.

   New regressions exercise malformed relationships, ordering preservation,
   unavailable auth storage, redacted diagnostics, public/private disagreement,
   rejected requests, invalid UTF-8, aborted uploads, successful/failed HTTP
   saves, concurrent sessions, and tracked-private-file rejection.

   Actual child processes exited without rollback at `prepared` and after each
   of the five replacements. Recovery restored the original hashes in every
   case. Corrupt-backup and manual-edit conflicts preserved the entire current
   file set; recovery succeeded after a deliberate fictional resolution.

   The collaborative browser exercised fictional data: wrong/correct unlock,
   Unicode/HTML-like text, unfinished-card saving, Discard cancellation and
   restoration, a real disk-failure rollback and retry, Lock cancellation,
   a dropped connection during an actual commit, an in-progress receipt and
   eventual recovery with exactly one operation, conflicting tabs, draft-export
   contents, reload locking, and `/family-preview/` relative URLs.

   The automated seven-case Playwright suite is available through
   `npm run test:browser`; it was not run in this pass. The shared preview's
   mobile resize timed out. On October 15, the actual application passed a
   390-pixel same-origin frame check under `/family-preview/`: no horizontal
   overflow, the editing form fit, input text was 16 pixels, and Save measured
   approximately 44 pixels high. This verifies responsive CSS, not a physical
   phone or its keyboard. Linux, Node 22, physical mobile browsers, hosted
   Pages, and live Cognito/API integration remain unverified here. API/auth
   tests use fictional inputs and substituted service boundaries. Process-exit
   recovery tests do not prove physical power-loss durability.

5. **Remaining decisions.** Current public/private metadata agrees, but that
   does not establish consent or prove that the real ciphertext contains the
   intended canonical version. No local family password was available.
   `npm run check:publish` correctly failed rather than claiming readiness.
   Review the existing 15-anchor privacy choices and verify source versus
   ciphertext locally before preparing any publication. The tracked historical
   ciphertext backup was retained and is excluded from the site manifest.

6. **Data safety.** All six existing data/metadata files, including the private
   source and historical ciphertext backup, retained their starting hashes.
   All 10 files in existing backup inventories were verified. An additional
   recovery copy of the current five artifacts plus the historical ciphertext
   was created under ignored `private/backups/stabilization-baseline-*`.
   Real records were never printed, used as test fixtures, or uploaded.
   The fictional preview servers were stopped. Four original temporary fictional
   browser directories remain outside the repository because automatic approval
   review rejected their deletion with "blocked by policy"; no real backups were
   targeted. The October 15 responsive-check fixture was also retained.

7. **Necessary next actions.** Review the local changes and the existing privacy
   choices. Enter the password locally to verify the intended source/ciphertext
   association and, only after that decision, prepare the family artifacts and
   release. Run the configured cross-platform/browser CI before publication.
   Any Pages-setting change, cloud deployment, commit, or push remains an
   explicit owner action.

## Tested recovery procedure

Stop the local server before manual recovery. Run `npm run recover -- --inspect`
to inspect operation states, then `npm run recover` to verify and restore the
recorded old set. A successful recovery can be repeated safely.

If a backup is corrupt or a current file has unknown bytes, recovery preserves
the current files and blocks writes. Preserve those files and the entire
transaction directory; compare them locally with the verified recovery copies.
Resolve the source choice explicitly before retrying. Do not delete journals or
force a live writer lock to bypass the conflict.

Fixture-only browser failure checks can be reproduced by setting
`FAMILY_PREVIEW_SAVE_FAULT` to `fail-once` or `lost-response-once` before running
`npm run preview:fictional`. These modes operate only on the isolated temporary
fictional project; the normal local server has no fault-control endpoint.
