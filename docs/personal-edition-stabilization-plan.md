# Personal edition: repair and stabilization plan

Status: proposed implementation plan; repairs have not been implemented.

Prepared: 2026-10-14. Baseline: `d5dc772` (`fix: repair admin suggestion query filtering`).

Audience: the owner/maintainer and the developer implementing the repairs.

For task-level agent execution, use the [six-stage implementation playbook](personal-edition-agent-plan/README.md). It expands this plan into file-level work, failure behavior, verification cases, and handoff prompts.

## 1. Intended result

Deliver a dependable personal family-tree edition with this workflow:

1. The maintainer starts the app locally and unlocks the tree.
2. The maintainer edits the canonical tree or applies a reviewed suggestion.
3. One save operation validates the data and prepares a coherent set of related artifacts.
4. The maintainer reviews any change in deliberately public information; the operation creates a recovery point and commits the approved local artifact set.
5. A publication check prepares a restricted static website for GitHub Pages.
6. Relatives view the encrypted tree after unlocking it and can send suggestions. Only the maintainer changes canonical data.

The personal edition remains independently usable when the future commercial product is developed, released, or unavailable.

### Scope boundaries

| Keep and improve | Outside this stabilization release |
| --- | --- |
| Static website and browser decryption | Paid plans, checkout, and subscriptions |
| One maintainer and local editing | Customer registration and independently owned trees |
| Text and visual suggestions | Connections or federation between trees |
| Existing isolated Cognito administrator review | Native iOS/Android applications |
| Reviewed additions-only patch application | A new framework or general UI redesign |
| GitHub Desktop commit/push workflow | Moving the canonical tree into an online database |
| Existing encryption format and graph invariants | New cryptographic algorithms or a claim of end-to-end identity security |

## 2. Verified starting point

The planning pass reran the existing test suite and examined the current source without modifying family data or contacting deployed AWS services.

| Finding | Evidence and practical consequence | Priority |
| --- | --- | --- |
| All 116 existing tests pass | `npm test`, Windows, Node `v24.11.1`. The suite does not cover several complete operational workflows. | Baseline |
| Public validation fails | `scripts/validate-public-build.mjs` exits 1 on the local private source. There are 22 missing required relationship arrays. | P0 |
| Source and public catalog disagree | Filling only missing arrays in memory produces valid canonical data with zero opted-in anchors; the tracked catalog contains 15 anchors. The generated backend artifacts agree with that catalog internally. | P0 |
| Local HTTP file serving includes the repository | `scripts/local-server.mjs` serves paths beneath the repository root. Earlier isolated tests at this baseline returned 200 for fictional private JSON, a private backup, and `.git/HEAD`. | P0 |
| Local writes lack request-origin protections | An isolated test accepted a valid synthetic save using an untrusted `Origin` and `Content-Type: text/plain`. This proves server acceptance, not universal exploitability in every browser. | P0 |
| Save paths update different file sets | Browser save replaces two files; anchor generation updates three more files separately; patch application performs its own replacement sequence. | P0 |
| Prepared files are replaced sequentially | Writing every temporary file first protects against preparation errors, but does not provide a multi-file transaction or restart recovery. | P0 |
| Private backups fail the current leak scanner | A fixture repository validates before adding a private backup and fails afterward. The scanner walks the working directory rather than the actual deployment output. | P1 |
| Final patch validation is not portable | Direct spawning of `npm` fails with `ENOENT` in this Windows environment. The patch CLI attempts this after replacing files. | P1 |
| Local/forked configuration targets production | `assets/site-config.js` contains deployed endpoints and a production OAuth callback. Development can contact production unintentionally. | P1 |
| Working edits and saved state are blurred on reload | `assets/app.js` stores working nodes in session storage; restoration calls `setNodes`, which treats them as the saved baseline. | P1 |
| CI differs from the primary editing environment | `.github/workflows/verify.yml` runs Ubuntu/Node 22 and lacks Windows CLI, real HTTP, and browser workflow checks. | P1 |

P0 means a release blocker for confidentiality or canonical-data integrity. P1 means required for the stabilized release. P2 means optional follow-up after release.

No real names, person identifiers, credentials, or private datasets belong in this plan, test fixtures, issue reports, CI output, or screenshots.

## 3. Architecture and implementation decisions

### 3.1 Preserve the personal trust boundaries

- The canonical plaintext source and recovery files remain local and ignored by Git.
- The published website contains only an explicit allowlist of site assets, the encrypted payload, and deliberately reviewed public metadata.
- The family password unlocks data in the browser. It is not an administrator identity or a suggestion-submission credential.
- The guest API stores suggestions, including whatever personal information a guest submits. It receives neither the canonical tree nor its password.
- Administrator review keeps separate Cognito authentication and its existing additions-only patch boundary.
- Accepting a suggestion is a review decision. Applying it locally changes canonical data. Publishing distributes the resulting release. The UI and documentation must distinguish these steps.
- The local server binds to loopback only. It is never deployed as the public website or exposed through a tunnel as part of this plan.

The static sharing model has limits: recipients can retain decrypted copies; password rotation cannot revoke old copies; removing public labels cannot erase previous Git history or archives. State these limits plainly in the maintainer guide.

### 3.2 Use an explicit publication directory

Retain the current `index.html`, `assets/`, and public `data/` URLs to reduce migration and GitHub Pages subpath regressions. A small Node build script copies only approved files into ignored `dist/`. Local HTTP serving and GitHub Pages publication use that directory.

Allowed public inputs:

- `index.html` and the required first-party scripts/styles;
- specifically selected vendored chart assets and favicon;
- `data/family.enc.json`;
- `data/family.anchors.public.json`;
- public runtime configuration generated for the selected environment;
- any hosting support file explicitly required by the deployment workflow.

Do not use a recursive copy of the repository, `data/`, or `assets/` without a reviewed file manifest. Reject unexpected files, hidden files, symlinks/junctions, and output paths escaping the intended directory. Resolve real paths before serving files.

### 3.3 Move private files through one explicit migration

Target layout:

```text
index.html
assets/
  app.js                         # Page composition and event wiring
  viewer/                        # Session state and chart adapter
  editor/                        # Local editing and save client
  suggestions/                   # Existing guest feature
  admin/                         # Existing administrator feature
  shared/                        # Small browser-safe utilities/contracts
data/
  family.template.json           # Fictional tracked starter
  family.enc.json                # Generated encrypted publication
  family.anchors.public.json     # Generated reviewed public catalog
private/                         # Entire directory ignored by Git
  family.json                    # Canonical plaintext source
  backups/
  transactions/                  # Recovery metadata and staged private files
api/
  src/
  generated/                     # Allowlist and revision; packaged for AWS only
scripts/
  lib/                           # Workflow, encryption, publication, file replacement
  local-server.mjs
  migrate-family.mjs
  prepare-family.mjs
  build-site.mjs
test/
docs/
dist/                            # Generated static site; ignored by Git
```

This is a responsibility map, not a requirement to create a module for every function. Extract code only where the repair needs a testable boundary. Broad CSS reorganization and vendor replacement are P2.

Migration must be dry-run capable, create a verified recovery copy, and detect both old and new canonical files. If both exist and differ, stop with a clear conflict; never silently choose one. Update all scripts and docs in the same change. Keep a temporary compatibility reader for the old path, without permitting two writable sources of truth. Remove the old local plaintext only after the new copy and recovery path have been verified.

### 3.4 Introduce one canonical workflow

Browser save, manual preparation, password rotation, and patch application call the same Node workflow service. CLI scripts become thin argument-parsing adapters and invoke Node modules directly rather than shelling out to `npm`.

The workflow prepares these five logical outputs from the same canonical snapshot:

1. Private canonical JSON.
2. Encrypted publication payload.
3. Reviewed public anchor catalog.
4. Backend anchor allowlist.
5. Backend canonical revision.

For a protected local browser save, the recommended implementation sends the validated draft and current password to the loopback-only save service, which generates the ciphertext itself. This prevents independently submitted private/encrypted files from disagreeing. The password is request-scoped: never log it, persist it in the transaction journal, return it, or forward it to an external endpoint. Document this local trust-boundary change. Browser decryption remains in the browser.

Keep the existing version-1 encryption envelope compatible. Validate the format and bounds, use fresh salt/IV values, and verify that decrypting each prepared payload reproduces the prepared canonical data. Test compatibility in both Node and Web Crypto. Successful output need not have identical ciphertext between runs.

### 3.5 Treat replacement as a recoverable transaction

Required sequence:

1. Acquire an exclusive writer lock and check for interrupted transactions.
2. Read the current canonical source and enforce the caller's expected saved version.
3. Validate the complete candidate, including graph invariants and publication metadata.
4. Prepare all outputs under ignored storage; perform decryption, artifact-consistency, and publication checks before replacement.
5. Produce an explicit diff of added/removed/changed public labels. A publication change requires a deliberate maintainer action; routine saves cannot silently opt people in.
6. Create and verify the recovery snapshot and transaction journal.
7. Replace prepared targets, record progress, and verify the resulting set.
8. Mark the transaction complete, then return success.

If an operation fails, restore the previous coherent set. If rollback itself fails or the process stops, keep recovery evidence and refuse further writes until recovery completes. Do not claim that separate file renames are globally atomic. `dist/` must not expose a partially updated release during local use or publication.

Use a local-only revision covering all canonical fields for concurrent-edit detection. The existing public `sourceRevision` intentionally omits display fields and is insufficient for detecting a stale name/birthday edit. Bind the version presented to the browser to the encrypted snapshot it loaded; the save endpoint must reject stale callers with a conflict and preserve their draft.

## 4. Work packages and acceptance criteria

### PE-01 — Preserve the baseline and repair the canonical source

Priority: P0. Depends on: none.

Implementation:

- Capture code/artifact versions and verified local recovery copies before changing any family file.
- Add a migration dry run that reports structural changes and publication differences without printing names by default.
- Fill missing relationship arrays with `[]` only when the field is absent; reject invalid populated values instead of guessing relationships.
- Preserve existing IDs, ordering/main-person selection, relationship endpoints, person fields, and privacy metadata.
- Validate before committing the migrated source. Compare it with the currently encrypted publication when the maintainer supplies the password locally; report divergence without picking a preferred version automatically.
- Reconcile current published anchors through the owner decision in section 8. The present catalog must not be treated as proof of consent.

Acceptance:

- A migration fixture is unchanged except for the documented path/empty-array changes.
- Migration is idempotent and refuses conflicting canonical files.
- The real source validates locally after migration and owner reconciliation.
- No public artifact is regenerated or published merely by running a dry run.

### PE-02 — Restrict HTTP serving and protect local writes

Priority: P0. Depends on: PE-01 path decisions; fixture work can begin immediately.

Implementation:

- Serve the approved `dist/` tree; deny every repository/private/API source path by default.
- Validate exact loopback Host values and ports; parse URLs using a trusted local base.
- For mutations, require the exact allowed local Origin, JSON content type, and an unpredictable per-process CSRF token delivered only to the local app. Reject missing/foreign Origin values and invalid tokens.
- Keep CORS closed to other origins. Apply Fetch Metadata checks where supplied as additional protection, without making them the only control.
- Start with a configurable 2 MiB local JSON-body limit and a request timeout; oversized requests return 413 before accumulating an unbounded body. Keep the existing separate 64 KiB guest API limit.
- Cover encoded separators, backslashes, Windows drive paths, traversal, symlinks/junctions, unsupported methods, malformed JSON, and aborted requests.
- Return structured errors; redact canonical content and credentials from logs.

Acceptance:

- Fictional private files, backups, `.git`, `.aws-sam`, API source, and generated backend-only artifacts return 403/404 for GET and HEAD.
- Foreign/missing Origin, invalid Host, invalid token, and `text/plain` requests cannot mutate any file.
- A valid same-origin save still works in the supported Windows/browser workflow.

### PE-03 — Unify saving, encryption, patching, and recovery

Priority: P0. Depends on: PE-01; integrates with PE-02.

Implementation:

- Extract reusable canonical validation, encryption-envelope, artifact-generation, and transaction services.
- Route the local save API and the existing maintenance commands through them.
- Generate all five outputs together, with a reviewable publication diff and consistent revisions.
- Replace the patch CLI's direct `npm` spawn with module calls or `process.execPath` for a Node script.
- Keep patches additions-only and revision-bound. Reject stale, duplicate/replayed, invalid, or canonical-to-canonical mutations without writing.
- Add exclusive-writer/concurrent-edit protection and recovery verification after restart.
- Preserve UTF-8 names and every supported private field through chart export, normalization, encryption, and reload.

Acceptance:

- One successful save produces a mutually consistent output set and a verified recovery point.
- The prepared ciphertext decrypts to the exact normalized candidate.
- Failure injection before and between every replacement leaves the old coherent set or an explicitly recoverable blocked state.
- Windows and Linux exercise the complete patch CLI, including its final validation.
- A second stale editing tab receives a conflict without overwriting the first tab's saved changes.

### PE-04 — Build, validate, and publish only approved files

Priority: P0 for the publication boundary; P1 for workflow automation. The manifest/site-assembly portion starts alongside PE-02 after PE-01 path decisions. Canonical freshness and final workflow integration depend on PE-03.

Implementation:

- Add `build-site.mjs` with an explicit public-file manifest, output-path checks, and clean-output handling confined to the verified build directory.
- Separate pure site assembly from secret-dependent family preparation. `build` must not unexpectedly rewrite canonical data or require the family password.
- Rework public validation to examine the actual site artifact. Validate generated field allowlists and catalog/backend agreement; use private-value leak checks locally as an additional check.
- Check Git tracking separately for private/recovery files. Ignoring a path must not exempt it if it is already tracked or copied into the deployment artifact.
- Keep legitimate private backups outside the publication scan. Fail if a backup enters `dist/`.
- Inventory the tracked recovery ciphertext file; retain a verified local recovery copy before deciding whether it belongs in version control. Ciphertext alone is not a confirmed plaintext leak.
- Add a GitHub Pages workflow that uploads only validated `dist/`. Verify repository Pages settings so a branch-root deployment cannot bypass it.
- Preserve relative paths and test the existing repository subpath, not only `/`.

Acceptance:

- A clean checkout with fictional data assembles a working site without production credentials.
- CI can check tracked artifact structure; a separate local check verifies freshness against the actual private source.
- A private backup does not fail legitimate local validation, but copying it into public output always fails.
- Public output contains no maintenance scripts, tests, configuration secrets, backend allowlist, or transaction files.

### PE-05 — Separate environment configuration and make optional services optional

Priority: P1. Depends on: PE-04.

Implementation:

- Supply a safe example configuration and explicitly generate local, test, and production public configuration.
- Disable external suggestion/admin services in local and test environments unless deliberately configured. Browser tests must fail on unintended production-network requests.
- Validate endpoint schemes and configuration shape. OAuth client IDs/domains are public metadata; passwords, access codes, tokens, and AWS credentials are not site configuration.
- Isolate optional administrator initialization so a network/authentication failure cannot prevent unlock, local save, or basic viewing.
- Handle disabled services, empty anchor catalogs, and API failures with clear UI states. Text suggestions remain usable when there are no public anchors; the visual chooser explains its availability.

Acceptance:

- The default local/test workflow makes zero requests to production AWS endpoints.
- A missing configuration or unavailable optional service does not break the family viewer.
- Production links and OAuth return URLs match the actual published origin/subpath.

### PE-06 — Make editing and review state reliable

Priority: P1. Depends on: PE-02, PE-03, and PE-05.

Implementation:

- Separate saved canonical state, the working draft, and renderer state. Make save progress, failure, and conflict states explicit.
- Extract the viewer/session and editor/save boundaries from `app.js` where needed for these repairs. Keep existing feature modules and chart assets.
- Stop restoring uncommitted nodes as though they were saved to disk. Recommended simple behavior: keep decrypted tree/draft data in memory, clear the old plaintext session-storage cache, and require a fresh unlock on reload. Warn before abandoning dirty work; document that a browser crash can still lose unsaved edits.
- Keep credentials out of persistent storage. Preserve the administrator's existing short-lived session behavior and clear it on Lock.
- Show useful validation/conflict/service errors instead of reporting every save failure as a missing local server. Keep the draft after failures.
- Refresh review revision metadata before acceptance/export; invalidate cached metadata after local saves and avoid comparing an unsaved draft with a published revision.
- Provide a repeatable patch download for accepted graph suggestions. Explain that acceptance/download does not mean local application or publication has happened.
- Verify names/text are safely rendered through canonical, suggestion, and review adapters; this is an inspection requirement, not a claim that every renderer currently has an injection defect.

Acceptance:

- Discard restores the last persisted state; a failed save remains dirty; successful save clears dirty state only after committed success.
- Reload/Lock/close behavior does not silently relabel unsaved data as persisted.
- Invalidated admin sessions show a sign-in path without losing the selected suggestion unnecessarily.
- Published mode offers no local-edit capability. Desktop and phone viewers can unlock, navigate, suggest, and close dialogs accessibly.

### PE-07 — Verify complete workflows on the supported platforms

Priority: P1. Depends on: PE-02 through PE-06.

Implementation:

- Keep the existing meaningful graph, API, and privacy tests. Add integration checks for HTTP, file replacement, restart recovery, publication assembly, and complete CLI execution.
- Use only fictional datasets and temporary directories in automated tests.
- Add Windows and Ubuntu jobs for the documented minimum Node version, with a supported newer Node version checked where declared. Keep runtime declarations consistent with the API and documentation.
- Install API dependencies from the existing lockfile and validate the API deployment package; the current dynamically imported SDK is otherwise bypassed by mocked unit tests.
- Add a small automated browser suite for unlock/edit/save/reload, guest suggestions, administrator review, and failure states using local fake services. Use the shared T3 preview for implementation-time manual browser checks when available.
- Test the minimum mobile viewport, keyboard dialog navigation, visible focus, and basic screen-reader labels without a broad visual redesign.

Acceptance:

- Every required scenario in section 5 passes in CI or has a recorded manual sign-off where real authentication/device behavior is involved.
- CI never needs the real private source or real family/submission credentials.
- A failed privacy, integrity, or packaging check prevents publication.

### PE-08 — Release, document, and rehearse recovery

Priority: P1. Depends on: PE-01 through PE-07.

Implementation:

- Update README, MAINTAINER, privacy/invariants, suggestion API, and administrator-review docs around the final paths and commands. Remove obsolete phase/future-tense descriptions.
- Document first setup, ordinary editing, publication review, password rotation, patch import, recovery, and disabled-service operation in PowerShell, with other supported shell examples as needed.
- Retain a known-good release artifact, matching backend generated metadata, and an ignored local recovery snapshot. Make a separately stored encrypted backup; Git is not a backup of ignored plaintext data.
- Rehearse restoration into an isolated directory and verify relationships, IDs, metadata, and decryptability. Backup completion alone is not proof of recoverability.
- Perform optional live AWS checks only against the intended deployment, after the preconditions in section 7. A local-only release must explicitly say live API checks were not performed.
- Record the release's validation results and remaining limitations without including private data.

Acceptance:

- The maintainer can follow the documented workflow without undocumented shell steps.
- Restoration succeeds from a separately stored backup in an isolated workspace.
- The release meets every gate in section 9.

## 5. Verification matrix

| Scenario | Required observable result | Verification |
| --- | --- | --- |
| Structural migration | IDs, populated relationships, fields, and privacy decisions preserved | Fixture tests + local owner review |
| Public/private path isolation | Forbidden paths cannot be read through GET or HEAD | Real local HTTP tests |
| Host/Origin/token enforcement | Invalid requests cause no file changes | Real local HTTP tests |
| Malformed/large/interrupted requests | Bounded rejection; no writes or sensitive logs | HTTP integration tests |
| Valid save | All outputs agree and ciphertext decrypts to the candidate | Workflow integration |
| Mismatched or malformed encryption | Rejected before any replacement | Crypto/envelope tests |
| Preparation/replacement failure | Previous set restored or recoverable write block recorded | Injected I/O failures |
| Process restart during replacement | Recovery completes before further edits are allowed | Child-process integration |
| Concurrent saves / display-only stale edit | Conflict preserves both the saved version and the caller's draft | HTTP + browser tests |
| Valid/stale/replayed patches | Valid patch applies once; invalid attempts do not write | Actual CLI tests on Windows/Linux |
| Backup scanning | Local private backup allowed; published backup rejected | Artifact integration tests |
| No-private-source checkout | Fictional build and structural checks pass without secrets | CI fixture build |
| Public artifact drift | Local preparation detects stale catalog/allowlist/revision | Artifact integration tests |
| Zero anchors / disabled API | Viewer and text path remain understandable; visual path explains its state | Browser tests |
| Wrong password / corrupt payload | Locked state retained; useful error; no data persistence | Browser + crypto tests |
| Save failure / Discard / reload / Lock | Correct dirty-state and credential cleanup behavior | Browser tests |
| Review accept/export/apply/publish | Each stage is clear; obsolete revision cannot be applied | Mocked integration + optional live review |
| GitHub Pages repository subpath | Assets, catalog, callbacks, and dialogs work under the real base path | Built-site browser tests |
| Network outage / expired administrator token | Basic viewer works; privileged path requests sign-in | Browser tests |
| Backup restoration | Recovered canonical data and public output validate and decrypt | Recorded restore rehearsal |

## 6. Commands and everyday workflow

These are proposed interfaces, not commands already implemented by this document. Existing commands should retain compatibility or produce a clear migration message.

| Proposed command | Purpose | Writes canonical/public data? |
| --- | --- | --- |
| `npm run migrate:family -- --dry-run` | Report legacy structural/path changes and conflicts | No |
| `npm run migrate:family` | Apply reviewed structural/path migration with recovery copy | Private data only |
| `npm run local` | Assemble/serve the local site and protected local API | Only through deliberate edits/saves |
| `npm run prepare:family -- --dry-run` | Validate candidate and report public metadata changes | No canonical replacement |
| `npm run prepare:family` | Validate, encrypt, generate, and commit a coherent local artifact set | Yes; password supplied locally |
| `npm run apply:additions -- --patch <file> --dry-run` | Validate a reviewed patch against the current source | No canonical replacement |
| `npm run apply:additions -- --patch <file>` | Apply using the common transaction workflow | Yes |
| `npm run validate:family` | Validate the canonical graph | No |
| `npm run validate` | Check publication artifacts; run private-source freshness checks when available | No |
| `npm run build` | Assemble and validate restricted `dist/` from prepared artifacts | `dist/` only |
| `npm run check:publish` | Run the documented local publication gates and create a redacted report | Report/build artifacts only |
| `npm test` | Unit and integration suite | Fictional temporary files only |
| `npm run test:browser` | Browser journeys against local fake services | Fictional temporary files only |

Normal maintainer workflow after stabilization:

1. Start locally and unlock.
2. Edit or review/apply an additions patch.
3. Save once and inspect any proposed public-label changes.
4. Run the publication check and confirm the release report.
5. Inspect the GitHub Desktop diff, commit, and push.
6. The Pages workflow publishes only validated `dist/`. If backend revision artifacts changed, perform the paired backend release described below before considering visual review fully current.

No save, migration, or patch command commits, pushes, deploys, rotates the password, or changes publication consent as an incidental side effect.

## 7. Deployment, AWS, and operating cost

The stabilization work reuses existing hosting and the optional suggestion/review stack. It does not require a new database, a permanent server, cross-Region infrastructure, or commercial infrastructure.

### Local and CI work

- Use fictional data and fake API/authentication services. Build public assets without production credentials.
- Check the SAM/API package locally or in CI without deploying resources.
- Keep runtime config public and explicit; keep AWS credentials in the existing protected environment.

### Preconditions for any live AWS work

- Check whether the project is on the Free Plan or has been upgraded to the Paid Plan; inspect spend status in AWS Settings > Billing.
- Ask the owner to confirm the selected Region in AWS Settings > View all projects > Overview > Additional Info > Region. If they cannot confirm it, inspect `~/.aws/config` and resolve any discrepancy before deployment.
- Keep all Regional resources in that selected Region. Do not introduce Lambda@Edge, StackSets, or cross-Region replication/routing. Keep administrator access through the existing managed experience.
- If services are unavailable, run `aws freetier get-account-plan-state` and check the appropriate supported-services documentation before proposing a replacement.
- If previously working operations suddenly return Access Denied, ask about a spend limit and check AWS Settings > Billing before changing permissions.
- If temporary resources are deliberately created, ask whether to retain or clean them up after verification. No temporary AWS environment is required by default.

### Match frontend and backend metadata

Changes to public anchors or graph topology can require a fresh API package because the Lambdas load generated allowlist/revision files. A GitHub Pages push alone does not update those deployed files.

- Produce frontend and API metadata from one prepared snapshot and record both versions.
- Confirm the public catalog and deployed API package match before declaring visual suggestion/review operations current.
- During a deployment mismatch, show a recoverable stale-version error and preserve the guest draft. Do not disable server validation to make a request succeed.
- Existing graph suggestions may become stale after a topology change. Keep them for inspection/rejection and explain resubmission; automatic rebasing is outside this release.
- A rollback restores the matching frontend/API artifact pair. It must not automatically overwrite newer local canonical work or rewrite administrator decisions.

Keep current rate limits, log retention, and narrow API permissions unless a verified defect requires a change. Review actual existing charges; this plan makes no new hosting-cost guarantee.

## 8. Owner decisions and safe defaults

These decisions do not block writing fixture-based code. Record the answer before the affected real-data migration or release.

| Decision | Recommended default | Why it matters |
| --- | --- | --- |
| Which local source represents the intended tree? | Compare canonical file, current encrypted publication, and recovery copies locally; stop on meaningful divergence | Prevents recovering the wrong snapshot |
| Which anchors should be visible without unlocking? | Publish no additional people; review an explicit list before retaining or changing the existing 15 public entries | Current source/catalog disagree; consent cannot be inferred |
| How should suggestions work with zero public anchors? | Keep the simple text form; explain that visual anchor selection is unavailable | Preserves suggestions without publishing names |
| Should unlocked data survive a browser reload? | Require a fresh unlock; keep decrypted content in memory | Simplifies saved/draft state and avoids plaintext session caching |
| Which browsers are supported for maintainer editing? | Current Edge and Chrome on Windows; phone browsers are supported for viewing/suggestions | Fits the existing GitHub Desktop workflow |
| How are backups retained? | Keep recovery generations locally; delete only explicitly reviewed old snapshots after a verified separate encrypted backup exists | Avoids an automatic cleanup policy destroying the sole recovery source |
| Is a live AWS verification/release included? | Make it a separately recorded release activity after plan/Region/spend checks | Local tests cannot prove deployed auth/configuration correctness |

Removing a public anchor from a future release is not a promise to erase historical copies. Do not automatically rewrite Git history or delete existing recovery files during stabilization.

## 9. Release gates and recovery procedure

The release is ready only when all applicable gates are met:

- [ ] Canonical source is valid and the migration diff preserves intended family information.
- [ ] Public metadata is explicitly reconciled and generated from that source.
- [ ] Browser save, manual preparation, and patch import use the same verified workflow.
- [ ] Private files and repository internals cannot be read through the local server.
- [ ] Invalid-origin, invalid-token, stale, and oversized saves cause no writes.
- [ ] Failure and restart recovery have been demonstrated, including a failed rollback path that blocks further writing.
- [ ] Ignored private backups do not poison public validation; published backups always fail it.
- [ ] Windows/Linux CLI integration and browser journeys pass.
- [ ] Default local/test runs do not contact production services.
- [ ] `dist/` contains only the approved file set and works under the actual Pages subpath.
- [ ] The Pages deployment uploads only the validated build artifact.
- [ ] Optional API behavior is either live-verified with matching metadata or explicitly recorded as unverified/disabled.
- [ ] A separately stored encrypted backup has been restored successfully in isolation.
- [ ] The maintainer guide matches the shipped commands and remaining privacy limitations.

For a failed rollout: stop further edits/publications, preserve the failed transaction and logs with sensitive values redacted, restore the previous published artifact pair, and recover local canonical files only from the verified transaction/backup procedure. Revalidate and decrypt the restored result before resuming. If the publication of private plaintext is discovered, stop serving it and assess the actual exposure; changing the family password alone does not erase disclosed plaintext.

## 10. Suggested change sequence and effort

Use small, reviewable changes in this order. Each change includes the implementation and its directly relevant checks.

| Change | Deliverables | Estimated focused effort |
| --- | --- | --- |
| 1. Baseline, migration, and public-consent report | PE-01, migration fixtures, private-path tracking guards | 0.5-1 day |
| 2. Restricted publication assembly and local HTTP boundary | PE-02 plus the essential manifest/build portion of PE-04 | 1.5-2.5 days |
| 3. Common workflow and recoverable replacement | PE-03, preflight validation, Windows patch CLI, recovery tests | 2-3.5 days |
| 4. Publication validation, environment config, Pages deployment | Remaining PE-04 and PE-05 | 1-2 days |
| 5. Editing/review reliability and narrow extraction | PE-06 and browser checks for repaired state transitions | 1-2 days |
| 6. Platform verification, documentation, restore rehearsal, release | PE-07 and PE-08 | 1.5-2.5 days |

Planning range: approximately 8-14 focused development days for one experienced developer, including the listed tests and documentation. This is a scope estimate, not a delivery commitment. Owner review, credential recovery, live AWS troubleshooting, and unexpected data divergence can add elapsed time. Re-estimate after the baseline/migration report and after the transaction implementation.

The critical path is: establish the correct source/publication policy -> restrict publication and local access -> unify writes/recovery -> verify real workflows -> release. Cosmetic restructuring should not delay these fixes.

## 11. Handoff record

The implementation handoff should contain:

- a redacted migration/publication decision record;
- the final path/command/configuration guide;
- test results by platform and required scenario;
- the public artifact inventory and matching API metadata versions;
- the backup restore rehearsal result and recovery instructions;
- any remaining limitations and explicitly deferred P2 work.

The separate commercial repository can later reuse reviewed graph rules, chart adapters, and fictional fixtures. Its accounts, billing, multi-tree permissions, mobile clients, and hosted canonical database remain outside this personal-edition release.
