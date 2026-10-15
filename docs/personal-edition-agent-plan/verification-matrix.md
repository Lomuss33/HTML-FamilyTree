# Verification matrix

Status: required future checks. This document does not mark any new repair case as passed.

The existing suite's 116-test baseline is evidence about the old implementation. Each case below must be connected to the repaired implementation and recorded in the implementation evidence ledger.

Use the [start-here guide](README.md) and [handoff templates](handoff-templates.md). A row is an observable requirement; several rows may be exercised by one well-designed test. Do not create implementation-mirroring tests solely to increase the count.

## Evidence conventions

| Label | Meaning |
| --- | --- |
| Unit | Pure graph/schema/crypto/state behavior using fictional values |
| FS | Real temporary filesystem with complete artifact-set assertions |
| HTTP | Real server/listener and real request/response boundary |
| CLI | Actual process entry point and exit/result behavior |
| Browser | Real DOM/network interaction against local fake services |
| Local owner | Private reconciliation performed locally; redacted evidence only |
| CI/package | Reproducible build/dependency/deployment artifact checks |
| Live optional | Authorized deployed-service observation; never inferred from local tests |

Results must be `not-run`, `pass`, `fail`, `blocked`, or `not-applicable` with a reason. A live-optional check may be not applicable for a local-only repair; a required confidentiality/integrity check cannot be skipped to enable release.

## Step 1 — Preserve and repair data

| Case | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| D01 | Missing relationship arrays only | Add absent empty arrays; preserve every other canonical value and ordering | Unit + FS |
| D02 | Already normalized source | Second migration is a semantic no-op and does not introduce artifact churn | Unit + CLI |
| D03 | Malformed populated relations | Reject null/scalar/string values; no guessed endpoints or replacement | Unit + FS |
| D04 | Duplicate IDs/cycles/reciprocity failures | Existing strict validator still rejects invalid topology | Existing Unit + migration integration |
| D05 | Privacy/extra fields/UTF-8/main person | All supported fields, opt-in values, unicode, and first-person/root selection survive | Unit + round trip |
| D06 | Migration dry run | Live input/output hashes unchanged; report contains aggregate/redacted findings | CLI + FS |
| D07 | Old/new source combinations | Correct single-source behavior; both-source conflict is explicit; no timestamp guessing | FS + CLI |
| D08 | Verified recovery and failed migration | Backup hashes match originals; failed candidate/replacement retains a recoverable original | FS |
| D09 | Git tracking/path/working-directory behavior | Private paths excluded/rejected if tracked; script resolves intended project outside cwd | CLI + FS |
| D10 | Real source and public consent reconciliation | DEC-01/DEC-02 recorded before affected real replacement/publication | Local owner |

## Step 2 — Secure local access

| Case | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| H01 | Import/start/shutdown | No listener on import; assigned port works; clean shutdown releases Windows handles | HTTP + process |
| H02 | Manifest-approved GET/HEAD | Correct allowed content/headers; HEAD has no body; no directory listing | HTTP |
| H03 | Private/repository/API paths | Private JSON, backups, .git, .aws-sam, API source/backend artifacts return 403/404 | HTTP with canaries |
| H04 | Traversal/encoded/Windows/sibling-prefix paths | No escaped file is served or selected as an output | HTTP + FS |
| H05 | Symlink/junction/missing public build | Escape rejected; failed build never activates repository-root fallback | FS + HTTP; platform limitation recorded |
| H06 | Invalid Host/origin values | Foreign/missing mutation Origin, Origin null, hostname suffix tricks, wrong Host/port are rejected without writes | HTTP |
| H07 | JSON/token/metadata controls | Text/form/multipart, absent/wrong token, contradictory Fetch Metadata fail before workflow invocation | HTTP |
| H08 | Oversized/malformed/aborted requests | Stream byte limit, JSON errors, timeout/abort produce bounded safe outcomes with no premature writes | HTTP |
| H09 | Valid protected mutation | Same-origin JSON/token request reaches the intended save service and returns structured result | HTTP |
| H10 | Capability discovery/protocol | Unknown response/HTML/unsupported version does not enable editing; no token in public files/storage/logs | HTTP + Browser |
| H11 | Error and log redaction | Canary secrets, canonical bodies, arbitrary stack details are absent from safe responses/logs | HTTP + logger capture |
| H12 | Published/local runtime distinction | Static-host API absence is read-only; no unauthenticated legacy write fallback | Browser + HTTP |

## Step 3 — Unify saving and recovery

| Case | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| T01 | Valid canonical preparation | All five outputs derive from one candidate and agree semantically | FS + workflow |
| T02 | Cross-runtime crypto | Node and Web Crypto version-1 envelopes decrypt each other's fictional output | Unit + Browser/Web Crypto |
| T03 | Wrong credential/malformed/tampered envelope | Authentication/format failures before replacement; no incidental password rotation | Unit + FS |
| T04 | Full canonical field preservation | UTF-8, private metadata, graph/root order, and supported extra data survive save/decrypt | Unit + FS |
| T05 | Full-state stale concurrency | First writer succeeds; second stale writer fails including name-only changes | HTTP + workflow |
| T06 | Snapshot/payload association | A current revision cannot be paired with an older/different payload to overwrite new data | HTTP + workflow |
| T07 | Public diff confirmation | Added/removed/changed labels require approval bound to candidate/base; cancel/expiry/reuse fail safely | Workflow + Browser |
| T08 | Valid/stale/replayed additions patch | Valid patch applies once with reciprocity; stale/replayed/mutation-like patches write nothing | CLI on Windows/Linux |
| T09 | Preparation and backup failure injection | No live target changes; verified recovery evidence remains where needed | FS |
| T10 | Failure after each replacement/final verification | Old complete set restored, or explicit RECOVERY_REQUIRED block; no silent mixed set | FS fault injection |
| T11 | Rollback failure and startup restart | Further writes blocked until inspected recovery; restarting resolves the journal safely | Child process + FS |
| T12 | Writer lock ambiguity | A live/uncertain writer is not displaced by age/PID assumptions; lock paths cannot escape | Process + FS |
| T13 | Lost response/idempotent retry | One committed result recognized; patch not applied twice; changed intent cannot reuse receipt | HTTP + workflow |
| T14 | Shared entry points and explicit rotation | All CLIs/API use one workflow; full Windows CLI succeeds; rotation/backups follow documented key generations | CLI + FS + source review |

## Step 4 — Stabilize publication and configuration

| Case | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| P01 | Exact public manifest | Required imports/assets included; arbitrary extra files forbidden | CI/package |
| P02 | Staged build activation | Build failure leaves current release intact; no half-written active site | FS + HTTP |
| P03 | Clean checkout/no private source | Fictional build and structural checks run without production credentials; skipped real freshness stated | CI/package |
| P04 | Real-source artifact drift | Stale catalog/allowlist/revision/encrypted association rejected locally | FS + local owner |
| P05 | Private backups versus public output | Ignored backups do not poison legit checks; copying a backup into dist always fails | FS + build |
| P06 | Tracking and canary leak guard | Already-tracked private files caught; public canaries flagged without printing secrets into shared output | Git fixture + build |
| P07 | Configuration modes and schema | Local defaults disabled; test endpoints loopback; production endpoints/returns validated; secret fields rejected | Unit + Browser |
| P08 | Optional service failure | Viewer/local editing survive missing config, auth failure, timeout, empty anchors | Browser |
| P09 | Repository base path | HTML/modules/catalog/links work at intended subpath and root | Built-site Browser |
| P10 | Reproducibility and safe cleanup | Same inputs/config yield same assembled output; no cwd/cleanup escape or canonical rewrite | FS + CLI |
| P11 | API generated package agreement | Packaged allowlist/revision match intended site catalog and contain no canonical source | CI/package |
| P12 | Publication workflow/settings | Only validated dist is uploaded; release branch/environment/concurrency correct; actual Pages source checked when authorized | Workflow tests + live optional |

## Step 5 — Repair editing and review

| Case | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| U01 | Optional bootstrap failure/slow redirect | Unlock controls remain wired/usable; optional error isolated | Browser |
| U02 | Wrong password/corrupt payload | Locked state retained; no decrypted content cache; safe actionable error | Browser |
| U03 | Saved/draft/chart separation | Card Save changes draft only; saved snapshot unaffected until committed page Save | Unit + Browser |
| U04 | Discard/dirty navigation | Discard restores saved state; abandoned dirty work requires deliberate choice; no autosave claim | Browser |
| U05 | Successful save and cache invalidation | Committed state, revisions, payload cache, and later fresh unlock agree | Browser + persisted fixture |
| U06 | Failed/ambiguous save | Draft retained; correct token/conflict/receipt/recovery action; no false success/failure assertion | Browser + fake failures |
| U07 | Plaintext session reload behavior | Old tree cache removed; reload requires unlock; unsaved state is never labeled saved | Browser + storage assertions |
| U08 | Lock with pending async work | Password/nodes/admin detail/preview references and DOM cleared; late callback cannot repopulate | Browser |
| U09 | Review saved context/current revision | Dirty drafts not silently original; stale metadata refreshed; unsafe accept/export blocked | Browser + request capture |
| U10 | Accept/download/re-download | Status accurately reported; failed download retry works without duplicate PATCH; local apply remains separate | Browser |
| U11 | Expired admin auth/credential boundary | Sign-in recovery works; family/submission secrets never sent as admin credentials | Existing Unit + Browser |
| U12 | Guest success/failure/stale/disabled | Draft resets only after success/discard; zero-anchor text path works; no private canonical fetch | Browser + network assertions |
| U13 | Safe text/avatar/error rendering | Fictional HTML-like values do not execute; unsafe URL handling rejected safely | Adapter Unit + Browser |
| U14 | Phone/keyboard/accessibility journeys | Essential viewing/suggestion/review dialogs remain usable with focus/status/error behavior | Browser + supported-device manual check |

## Step 6 — Verify and release

| Case | Scenario | Required result | Evidence |
| --- | --- | --- | --- |
| R01 | Windows/Ubuntu and declared Node versions | Meaningful suite/CLI discovery passes on supported platform/runtime combinations | CI |
| R02 | Locked dependencies and API package | Reproducible installs; actual handler imports/generated files validated, not only mocked SDK paths | CI/package |
| R03 | Browser fake-service isolation | Required journeys run; unexpected external traffic fails; traces/screenshots fictional only | Browser CI |
| R04 | Separate encrypted backup restoration | Isolated restore validates/decrypts/regenerates without altering live files | FS + recorded rehearsal |
| R05 | Restore failure/unsafe destination | Wrong key, corrupt/incomplete backup, and escaping path fail without writes | FS + CLI |
| R06 | Documentation/command accuracy | Documented PowerShell daily/recovery commands run as described; old bypass paths removed | CLI + review |
| R07 | Final real-data release candidate | Source identity, consent, artifact freshness, decryptability, and absence of interrupted transactions verified | Local owner + workflow |
| R08 | Site/API release record | Code, public artifact, metadata/package, environment, and deployment states separately recorded | Release report |
| R09 | Authorized live AWS preconditions | Plan/spend/selected Region/permissions checked; no unrequested new resources | Live optional |
| R10 | Live guest/admin/revision smoke | Intended deployed paths/auth/current/stale behavior verified with fictional records | Live optional |
| R11 | Paired rollback without canonical loss | Known-good site/API pair recoverable; newer local work/review history not silently overwritten | Rehearsal + live optional |
| R12 | Final claims and handoff | Every required case has evidence/status; unresolved blockers stated; local/live/released claims accurate | Handoff review |

## Cross-cutting invariants

These apply to every case:

1. A rejection cannot be considered safe if an earlier file already changed.
2. A committed operation is recognized even if its HTTP response was lost.
3. Names/relationships/privacy fields are not silently discarded during adaptation.
4. New people are private unless explicitly opted in through reviewed metadata.
5. Family password, guest code, administrator token, and local CSRF token remain separate.
6. No test/CI workflow receives production canonical data or real credentials.
7. Unknown owner decisions stay explicit; they are not answered by a passing fixture.
8. An API/static deployment mismatch never leads to relaxed server validation.
9. Backup existence is not restoration evidence.
10. A live release claim needs actual live release evidence.

## Coverage ledger format

Use one or more rows per test/manual procedure:

```text
Case IDs:
Implementation boundary:
Test/procedure path:
Command or procedure:
Platform/runtime/browser:
Result:
Evidence reference:
Limitations/skips:
Last relevant code version:
```

Store real-family detailed evidence only in ignored local records. Link/reference it abstractly from the redacted tracked handoff.
