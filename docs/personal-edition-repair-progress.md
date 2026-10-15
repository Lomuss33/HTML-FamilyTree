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
