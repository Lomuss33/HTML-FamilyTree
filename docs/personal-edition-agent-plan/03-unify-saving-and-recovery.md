# Step 3 — Unify saving and recovery

Task range: `SAVE-01` through `SAVE-08`. Verification cases: `T01` through `T14`.

Read the [start-here guide](README.md) and the step-1/step-2 handoffs. This is the canonical-data integrity stage. Implement it as a small, explicit local workflow, with failure injection and recovery evidence.

## 1. Outcome

Every supported canonical change uses one service that validates, encrypts, generates, reviews publication changes, backs up, replaces, verifies, and reports the result. A failed or interrupted operation cannot silently leave a usable-looking inconsistent set.

The four operations are:

| Operation | Input | Special requirement |
| --- | --- | --- |
| Browser edit save | Working canonical draft | Known loaded snapshot, current password, stale-state protection |
| Manual preparation | Deliberately edited local source | Explicit current-source read and publication diff |
| Additions patch | Reviewed deterministic patch | Exact source/catalog match, additions-only, replay protection |
| Password rotation | Current source and explicitly chosen new password | Dedicated operation; old backups remain associated with their original key |

Do not introduce a second write service for one of these operations.

## 2. Read these implementations

- `scripts/local-server.mjs`: current two-file save helper.
- `scripts/encrypt-family.mjs`: current Node encryption and argument parsing.
- `scripts/generate-public-anchors.mjs`: generation and temporary-file replacement.
- `scripts/apply-family-additions.mjs`: validation, backup, sequential replacement, and final `npm` spawn.
- `scripts/validate-family-data.mjs`: normalization/revision contracts.
- `assets/app.js`: current browser encryption and persistence.
- `assets/admin/patch-model.js`: deterministic stable IDs and patch schema.
- Existing encryption/local-save, patch, revision, and artifact tests.

Current tests that accept placeholder "encrypted" strings are insufficient to prove a ciphertext/canonical round trip. Replace or supplement those assertions with real fictional encryption.

## 3. Task SAVE-01 — Define one workflow contract

Suggested service boundary:

```text
prepareFamilyChange({
  operation,
  candidateOrPatch,
  expectedSnapshot,
  credential,
  operationId,
  projectPaths
}) -> PreparedChange

commitPreparedFamilyChange({
  preparedChangeId,
  publicationApproval,
  expectedSnapshot,
  operationId
}) -> CommittedChange

inspectFamilyRecovery(projectPaths) -> RecoveryState
recoverFamilyTransaction(projectPaths, selectedRecovery) -> RecoveryResult
```

The implementation may combine prepare/commit for changes that do not alter public metadata, while preserving the same validation and transaction boundaries.

Principles:

- A prepared change is bound to one candidate digest, source snapshot, operation type, and public-metadata diff.
- Recheck the source under the writer lock before committing. Preparation does not reserve permission to overwrite a later edit.
- Credentials are request-scoped/in-memory only. They are not part of returned models, logs, approval documents, or transaction journals.
- Result objects expose safe status, revisions, counts, changed artifact classes, and recovery outcome.
- Filesystem access, clock, fault injection, and crypto invocation can be injected where needed for meaningful tests.
- Canonical validation remains authoritative; chart state and browser-side validation are advisory.

Use a few focused modules under `scripts/lib/` rather than a framework. Suggested responsibilities: project paths, crypto envelope, canonical preparation, artifact generation, file transaction, publication validation.

## 4. Task SAVE-02 — Generate a coherent candidate

The canonical preparation service:

1. Reads or receives a plain JSON candidate appropriate to the operation.
2. Applies only documented chart/export normalization.
3. Validates complete canonical invariants and permitted privacy fields.
4. Preserves every supported private field, stable ID, populated relationship, ordering/main person, and publication choice.
5. Generates the encrypted payload from that candidate.
6. Builds the catalog, backend allowlist, and backend revision from the same candidate.
7. Computes the publication diff against the previous approved artifacts.
8. Verifies all outputs before any live target changes.

The five logical outputs are fixed:

```text
private/family.json
data/family.enc.json
data/family.anchors.public.json
api/generated/public-anchor-allowlist.json
api/generated/canonical-revision.json
```

This list is a transaction target allowlist. Candidate input must not supply arbitrary output paths, file names, shell commands, or executable callbacks.

### Important normalization distinction

The migration stage fills absent arrays in legacy data. Routine saves should not silently "repair" arbitrary malformed structures or discard fields. Normalize known chart export artifacts, validate, and reject genuine errors with a useful safe message.

Do not drop `privacy` or extra retained `data` fields while reconstructing person objects. Do not persist renderer-only temporary people/flags.

## 5. Task SAVE-03 — Preserve encryption compatibility and prove correspondence

Extract the current encryption into an import-safe Node module. Keep CLI parsing in a thin script.

Envelope compatibility:

- `version: 1`, `kdf: PBKDF2`, `hash: SHA-256`.
- AES-256-GCM using the current salt/IV/tag conventions.
- Fresh random salt and IV for each new encryption.
- Current work-factor behavior remains compatible; validate supported bounds and reject pathological parameters before expensive work.
- Strictly validate base64 encodings and decoded field lengths. Node's permissive base64 decoder alone is not validation.
- Reject malformed/truncated ciphertext and authentication-tag failures.

Do not design custom crypto primitives. Use the platform APIs and verify the existing envelope's actual behavior.

Required compatibility checks with fictional data:

1. Node-generated payload decrypts with Web Crypto.
2. A compatible browser-generated fixture decrypts with Node.
3. Wrong passwords and changed ciphertext fail authentication.
4. UTF-8 names and all canonical metadata round-trip.
5. Prepared ciphertext decrypts to the exact normalized candidate, using a stable semantic comparison.
6. Output randomness does not become a brittle "same ciphertext" assertion.

### Local browser save credential boundary

The local browser sends the candidate and current password only to the protected loopback API from step 2. The local service produces ciphertext itself. It must never forward this request to the guest/admin APIs.

For ordinary saves, verify the expected current payload/source association and password before replacement. Password rotation is a deliberate separate operation; a typo in a save must not silently change the family password.

Keep raw passwords out of CLI arguments. Prefer local secret input or an explicitly configured transient environment variable, with errors/logging that do not echo it.

## 6. Task SAVE-04 — Bind snapshots and detect stale edits

The public `sourceRevision` hashes IDs/topology, intentionally excluding names, birthdays, avatars, and other display fields. Keep that public contract unchanged.

Introduce a local-only saved-state revision covering all canonical fields. Use it for concurrency, with a snapshot association to the ciphertext loaded by the browser.

Suggested save request, after the HTTP envelope checks:

```json
{
  "operationId": "opaque-random-request-id",
  "snapshotId": "snapshot-returned-for-the-loaded-payload",
  "expectedRevision": "local-only-full-state-revision",
  "nodes": [],
  "password": "request-scoped-local-secret",
  "publicationApprovalToken": "present-only-when-needed"
}
```

The empty array and strings illustrate the shape; a real save must satisfy strict validation.

Concurrency rules:

- Two browser tabs loading the same snapshot may edit independently.
- The first committed save advances the full local revision.
- The second tab's stale save returns 409 and keeps its draft.
- A name-only edit also advances the local revision even when topology does not change.
- CLI/manual operations participate in the same writer lock and stale-state rules.
- The browser cannot obtain a current revision from one payload and use it to overwrite from a different older payload without detection.
- Restarted servers invalidate process tokens and reissue correctly associated snapshots.

Use a stable operation ID for one save attempt and its retries. A retry after a lost HTTP response must not apply a patch twice or report a committed operation as a fresh uncommitted draft. Store a safe receipt or provide a protected status lookup. If an ID is reused for a different candidate/intent, reject it.

## 7. Task SAVE-05 — Make publication confirmation specific

When prepared public metadata differs:

1. Return a local preview that lists exact additions, removals, and label changes.
2. Explain that the values become public without unlocking.
3. Require a deliberate confirmation of that prepared candidate.
4. Bind a short-lived opaque approval token to the candidate digest, expected base revision, and public-diff digest.
5. Recheck the binding immediately before commit.

A confirmation for candidate A must not authorize candidate B or a later source revision. Do not accept a general boolean "publish everybody" or reuse an unrelated previous confirmation.

An ordinary save with unchanged public labels need not interrupt the maintainer with a redundant consent prompt. Updating graph revision metadata still requires consistent artifact generation and a later paired API release.

The bulk opt-in CLI remains an explicitly named owner action. It must use the same preview/confirmation and workflow rather than a hidden alternate write path.

## 8. Task SAVE-06 — Implement recoverable multi-file replacement

### State machine

```text
NEW
  -> LOCKED
  -> PREPARED
  -> VALIDATED
  -> BACKED_UP
  -> REPLACING
  -> VERIFIED
  -> COMMITTED

Any pre-replacement failure -> ABORTED, live set unchanged
Replacement/verification failure -> ROLLING_BACK
ROLLING_BACK -> ROLLED_BACK
Rollback failure or interrupted recovery -> RECOVERY_REQUIRED
```

Required mechanics:

- Acquire an exclusive writer lock using an actual exclusive filesystem operation.
- Store transaction metadata only in ignored private storage.
- Identify targets by approved artifact IDs mapped through trusted paths. Never replay arbitrary paths taken from a journal.
- Validate path containment and real-path behavior on creation, commit, rollback, recovery, and cleanup.
- Prepare and validate every new output before the first live replacement.
- Back up all existing targets, including whether a target did not exist, and verify backup hashes.
- Write replacement progress to the journal so recovery can distinguish old/new states.
- Use same-filesystem prepared replacements for individual targets and verify each result.
- Flush relevant data/journal state where supported; document actual Windows behavior instead of assuming POSIX durability.
- Do not automatically discard transaction evidence when an error occurs.

### Lock handling

Record enough ownership information to detect a live writer. Do not delete a lock just because it is old. PID reuse or permission-denied process checks must not be treated as proof a writer is dead.

On uncertain lock ownership, inspect and report; do not force an overwrite. A recovery command may offer a concrete inspected action after the owner resolves ambiguity.

### Rollback and restart

If a replacement fails, restore the previous complete set and verify it. If restoration fails, keep the journal/backups and return `RECOVERY_REQUIRED`. Block additional writes and public rebuilding until recovery resolves the state.

On startup, inspect interrupted transactions before reporting local saving as available. Recovery can restore prepared backups without retaining a family password in the journal.

Separate file renames are not globally atomic. A local static server must continue serving a known-good release or temporarily pause the relevant reads while a new complete release becomes active. Never serve staged private files.

### Outcome reporting

Return success only after committed verification. If the operation commits but response delivery fails, the safe receipt/status path must allow the UI to recognize that outcome. A transport error is not proof the filesystem was unchanged.

## 9. Task SAVE-07 — Route every maintenance entry point through the service

| Existing entry point | Required adaptation |
| --- | --- |
| Browser `/api/save` | Candidate/password/snapshot request; server-generated ciphertext |
| `encrypt-family.mjs` | Import-safe crypto plus compatibility adapter; no independent live partial overwrite |
| `generate-public-anchors.mjs` | Pure artifact builder retained; live writes coordinated by workflow |
| `apply-family-additions.mjs` | Keep pure additions validation; use common preparation/transaction and Node module validation |
| `enable-all-public-anchors.mjs` | Explicit privacy operation with reviewed diff; common write authority |
| New `prepare-family.mjs` | Normal owner CLI for coherent preparation |
| Recovery/backup command | Inspect/restore verified operations; never commit/push/deploy implicitly |

Remove the direct `npm` spawn after patch replacement. Import validators directly, or invoke a Node entry with `process.execPath` if a process boundary is necessary.

Patch specifics:

- Preserve deterministic suggestion-derived IDs.
- Validate the expected source/catalog before applying.
- Reject duplicates/replays clearly and without partial work.
- Keep the patch additions-only.
- Generate reciprocal links and revalidate the full result.
- Never infer public consent for new people; absent metadata remains private.

A separate encrypted backup/export should use the compatible family envelope and be test-decrypted before it is labeled recoverable. Restoring it must run validation and the normal publication-diff rules, not blind-copy historical data into the live website.

## 10. Task SAVE-08 — Prove failures and recovery

Use real temporary files and the actual workflow. Inject failures at:

- input validation and encryption;
- each staging write;
- backup copy/verification and journal update;
- each live replacement;
- final verification;
- each rollback replacement;
- process interruption during replacement;
- restart with a stale or ambiguous writer lock;
- commit success followed by response loss.

For each failure, assert the entire logical artifact set, not one selected file. A valid final state is either the old coherent set, the new committed set with a known receipt, or an explicitly blocked recoverable state. A silent mixed set is always a failure.

Do not overclaim power-loss guarantees. Document the tested process-interruption behavior and filesystem limitations.

## 11. Proposed file map

```text
scripts/lib/project-paths.mjs
scripts/lib/family-crypto.mjs
scripts/lib/family-workflow.mjs
scripts/lib/file-transaction.mjs
scripts/lib/publication.mjs
scripts/prepare-family.mjs
scripts/recover-family.mjs
test/family-workflow.test.mjs
test/family-transaction.test.mjs
test/family-crypto-compatibility.test.mjs
test/patch-cli.test.mjs
```

Names can be adjusted. Keep the boundaries and avoid duplicate implementations.

## 12. Exit and handoff

- All five outputs derive from one candidate.
- Wrong credentials, invalid graphs, stale saves, and unapproved publication changes cause no replacement.
- Concurrent writes are controlled.
- Every entry point uses the shared workflow.
- Windows full CLI execution succeeds.
- Rollback/restart cases have evidence.
- The browser/API contract and safe outcome codes are documented for step 5.
- Step 4 can build from a verified committed artifact set.

## 13. Agent assignment prompt

> Implement step 3 of the personal-edition agent playbook. Create one import-safe canonical preparation/commit service for browser saves, CLI preparation, patch application, and explicit password rotation. Preserve the existing encryption envelope, verify round trips, bind full-state snapshots and publication confirmation, and implement journaled recovery with an exclusive writer. Route all entry points through it and remove the Windows npm-spawn failure. Prove each failure boundary with fictional files and record the handoff contracts for publication and UI work.
