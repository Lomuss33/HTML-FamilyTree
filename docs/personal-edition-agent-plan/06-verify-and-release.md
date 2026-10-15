# Step 6 — Verify and release the personal edition

Task range: `REL-01` through `REL-08`. Verification cases: `R01` through `R12`, plus all earlier matrix cases.

Read the [start-here guide](README.md), all stage handoffs, and the [verification matrix](verification-matrix.md). This stage establishes evidence and a usable maintainer workflow; it must not declare incomplete work "done" because a test count increased.

## 1. Outcome

The personal edition is reproducible, tested on its supported platforms, recoverable from a separate encrypted backup, and ready for an explicitly authorized release. The final report distinguishes implemented code, fixture verification, real-data reconciliation, and live deployment.

Commercial/mobile development remains outside this release.

## 2. Task REL-01 — Consolidate requirement evidence

For every matrix case:

1. Link it to the implemented boundary and the test/manual procedure exercising it.
2. Record platform, result, and any meaningful limitation.
3. Confirm that the assertion tests observable behavior, not just a helper returning the expected hardcoded value.
4. Identify cases marked skipped and why.
5. Reclassify an unresolved privacy/integrity case as a release blocker rather than accepting a silent skip.

Required evidence types:

| Type | Proves | Does not prove |
| --- | --- | --- |
| Pure unit tests | Graph/schema/state/crypto logic | HTTP, CLI, disk replacement, or deployment settings |
| Real local HTTP tests | Server request and path boundary | Every browser's surrounding network policy |
| Filesystem/child-process tests | Actual replacement, CLI, restart, and recovery behavior | Unlimited power-loss guarantees |
| Browser fake-service journeys | DOM/state/network integration | Production Cognito configuration |
| Local real-source checks | Current source/artifact freshness | Public deployment is current |
| Authorized live checks | Specific deployed auth/config/revision behavior | Future uptime or absence of all vulnerabilities |

Keep reports concise and redacted. Do not attach real family screenshots or private diff files.

## 3. Task REL-02 — Make CI match the supported project

### Runtime and install contracts

- State the supported Node baseline consistently in root/API metadata and documentation.
- Include Windows and Ubuntu for the unit/integration/CLI suite.
- Check a newer declared supported Node version where appropriate.
- Verify test discovery is identical across shells; a wildcard that discovers zero tests is not a passing suite.
- Install root dev dependencies from a root lockfile if browser tooling is added.
- Install API dependencies with its existing lockfile and exercise the actual deployment package structure.
- Keep vendor versions/provenance documented; do not update dependencies opportunistically during stabilization without need.

### CI job responsibilities

| Job | Required checks |
| --- | --- |
| Unit/integration Windows + Ubuntu | Graph rules, crypto, migration, real HTTP, CLI, transaction/recovery |
| Site build/privacy | Manifest, public schemas/config, Git tracking guard, repository subpath |
| Browser smoke | Fictional viewer/edit/save/suggest/review/error journeys |
| API package/template | Dependency installation, handler imports/packaging, generated metadata, local SAM/template validation when tools are available |
| Publication | Only after required jobs; upload validated `dist/` |

Avoid duplicating an entire slow browser matrix without an actual browser-specific concern. Run essential automated coverage and record manual supported-browser checks where needed.

Do not place real family keys/data in CI to make private-source freshness checks run. CI uses fictional canonical fixtures; local publication has its own real-source gate.

Use current official documentation for workflow action/tool versions during implementation. Do not assume versions in an old example are automatically suitable.

## 4. Task REL-03 — Add the smallest useful browser suite

Use the project's chosen maintainable browser test runner with a local server and fake API/authentication service. This is code committed for CI; implementation-time interactive browsing still follows the active T3 tool preference.

Fixtures:

- a fictional multi-generation canonical tree;
- a known fictional password;
- zero-anchor and approved-anchor catalogs;
- pending text/graph suggestions with current and stale revisions;
- an accepted graph suggestion for repeat download;
- malformed/corrupt payloads and a disabled-service config.

Network rules:

- Only local origins explicitly listed for the test are allowed.
- Unexpected external API/Cognito requests fail the test.
- Fake auth endpoints exercise redirect/state/PKCE handling without production credentials.
- No real guest code or family password enters screenshots, traces, or fixture names.

Minimum automated journeys:

1. Unlock/read/Lock and wrong-password failure.
2. Local card edit -> page Save -> fresh unlock shows committed data.
3. Discard and dirty-navigation behavior.
4. Invalid save and stale-tab conflict retain the draft.
5. Publication preview cancellation/confirmation.
6. Zero anchors, disabled config, and optional-service outage.
7. Guest simple/visual success, retry, stale catalog, and discard.
8. Admin sign-in/session expiry, graph comparison, accept, failed download, repeat download, and rejection.
9. Lock while an async request is pending.
10. Actual repository base path and minimum mobile viewport.

Do not use fragile pixel-perfect snapshots as the main correctness check. Assert meaningful UI states, requests, persisted fictional data, and accessible controls.

## 5. Task REL-04 — Rehearse backup and restoration

The restoration exercise must use a separate copy and an isolated directory.

Preparation:

1. Produce a compatible encrypted backup from a known-good canonical snapshot.
2. Test-decrypt it locally and verify its semantic canonical digest.
3. Store a copy separately from the working repository/transaction directory.
4. Record which password generation protects it, without recording the password.

Rehearsal:

1. Create an isolated restore workspace with no live output paths.
2. Decrypt the separate backup using local secret entry.
3. Run strict canonical validation.
4. Check IDs, relationships, main person, private fields, and privacy metadata against the expected snapshot.
5. Run the common preparation workflow and validate regenerated artifacts.
6. Assemble a restricted public site and unlock it with the intended credential.
7. Confirm that restoring into this workspace changed no live canonical/public file.
8. Record success/failure and limitations without family values.

Also test a wrong password, corrupt backup, incomplete transaction backup, and attempted restore to an escaping output path. All must fail safely.

Backup retention:

- Do not automatically delete the only old snapshot during migration or cleanup.
- Keep incomplete recovery transactions until inspected and resolved.
- Password rotation does not re-encrypt historical backups automatically.
- Document how the owner locates backups and chooses a deliberate retention policy.

## 6. Task REL-05 — Rewrite the maintainer workflow

Update these documents:

| Document | Required content |
| --- | --- |
| README | Purpose, setup, supported runtime, current files, simple daily flow |
| MAINTAINER | Migration, Save, public-label review, preparation, checks, publication, recovery |
| Privacy model | Public/locked/unlocked/local/AWS boundaries and historical-publication limits |
| Data invariants | Canonical paths/schema, local/full revision versus public topology revision |
| Suggestions/API docs | Current configuration modes, empty catalog behavior, guest-data handling |
| Admin review docs | Separate login, acceptance/download/application/publication, stale-version recovery |
| New recovery/release runbook if useful | Exact inspected restore and paired site/API rollback process |

Replace obsolete future-tense/phase labels with shipped behavior. Do not leave old paths/commands that bypass the new workflow.

Command documentation must state which commands:

- read only;
- prepare private temporary files;
- replace canonical/generated data;
- build public output only;
- contact external services;
- commit/push/deploy only when explicitly invoked through the authorized release process.

Provide Windows/PowerShell examples that actually execute successfully. Additional shell examples should be checked rather than translated by guesswork.

## 7. Task REL-06 — Perform the final local release candidate check

Preconditions:

- Code changes and relevant checks are complete.
- DEC-01/DEC-02 are resolved for the intended real-data release.
- No unresolved writer lock/interrupted transaction exists.
- The maintainer's current work is preserved.

Run in this order:

1. Verify strict canonical validity and expected source identity locally.
2. Verify public-label decisions and prepared artifact freshness.
3. Verify decryptability locally with a credential supplied outside chat/logs.
4. Run targeted/full checks appropriate to the final changes.
5. Assemble and validate the final public artifact.
6. Inspect its file inventory and forbidden-path assertions.
7. Test actual publication base-path behavior.
8. Confirm the matching API generated metadata/package.
9. Confirm the separate encrypted backup restoration evidence.
10. Produce the redacted release candidate record.

Do not run "build" if it still secretly re-encrypts/replaces canonical files; fix that command contract first.

An owner decision pending, failed integrity check, or stale real-source publication blocks release. It does not invalidate useful fictional mechanism verification already completed.

## 8. Task REL-07 — Handle optional live release correctly

This stage may end at a verified local release candidate if live deployment has not been requested. Do not turn a plan or local repair into an unrequested deployment.

Before any AWS work:

- Check available relevant AWS skills/tools and follow applicable guidance.
- Confirm Free/Paid Plan status and spend information in AWS Settings > Billing.
- Confirm the selected Region in AWS Settings > View all projects > Overview > Additional Info > Region; inspect `~/.aws/config` if the owner cannot confirm.
- Use the selected Region for every Regional resource/action. Do not introduce Lambda@Edge, StackSets, or cross-Region resources/routing/replication.
- On suddenly failing formerly working Access Denied operations, check spend-limit status before changing permissions.
- If a service is unavailable, use `aws freetier get-account-plan-state` and the relevant supported-service documentation.
- Prefer the existing stack and explicit code/package changes. No temporary AWS environment is required.

Live validation, when authorized:

1. Inspect the intended stack/origin/callback configuration.
2. Release the approved API package and website artifact as a matched pair.
3. Verify simple suggestion submission with fictional content and controlled cleanup/retention.
4. Verify administrator authentication, authorization, pagination, review status, and stale graph rejection.
5. Verify that canonical data and family credentials never appear in backend requests/logs.
6. Record which actual deployment versions were verified.

Do not broaden IAM permissions to make the smoke test pass. Investigate a concrete failure first. If any temporary resources were created, ask whether to clean them up or retain them, as required by repository guidance.

Verify Pages repository settings so only the intended workflow publishes. A code diff alone cannot establish the deployed settings.

## 9. Task REL-08 — Rehearse rollback and write the final handoff

Rollout failure procedure:

1. Stop new publication/writes that would obscure the failed state.
2. Preserve transaction and deployment evidence, with sensitive details kept private.
3. Select the known-good site/API artifact pair.
4. Restore those published artifacts deliberately.
5. Recover local canonical files only through the verified transaction/backup process and only if local recovery is needed.
6. Revalidate/decrypt the recovered result before resuming.
7. Record what changed and why; do not rewrite review history or overwrite newer canonical work automatically.

If private plaintext was published, remove the serving path and assess the actual disclosure. Password rotation alone cannot erase exposed plaintext or copied public labels.

Final handoff includes:

- implementation scope and code paths;
- completed/remaining task and verification IDs;
- tested platforms/commands/results;
- owner reconciliation state;
- release artifact inventory and matching API metadata;
- backup restore and rollback rehearsal results;
- live deployment status, if any;
- remaining limitations and explicitly deferred P2 work.

Keep the future commercial repository out of this handoff's implementation claims.

## 10. Release gates

- Canonical source is valid and intended.
- Public labels are explicitly reconciled.
- Every canonical writer uses the common protected/recoverable workflow.
- Forbidden HTTP paths and invalid writes are rejected.
- Ciphertext/canonical round trips and full-state concurrency checks pass.
- Recovery after failure/restart is demonstrated.
- Windows/Linux CLI and browser journeys pass.
- Local/test defaults cannot contact production accidentally.
- Public build contains only approved content and works at the actual base path.
- Website/API generated metadata agree.
- Separate encrypted-backup restoration succeeds.
- Documentation matches shipped behavior.
- Live-only claims are either verified or explicitly not made.

## 11. Agent assignment prompt

> Implement step 6 of the personal-edition agent playbook. Close the verification matrix with meaningful Windows/Linux HTTP/CLI/filesystem/browser evidence, verify package/build contracts, rehearse restoration from a separate encrypted backup, and update the maintainer/runbook documentation. Prepare a redacted release candidate and matched site/API metadata record. Deploy only if explicitly authorized and after required AWS/Pages checks. Distinguish local verification, real-data reconciliation, and actual release status in the final handoff.
