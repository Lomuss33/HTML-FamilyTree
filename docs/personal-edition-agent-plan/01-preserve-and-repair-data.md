# Step 1 — Preserve and repair the data

Task range: `DATA-01` through `DATA-06`. Verification cases: `D01` through `D10`.

Read the [start-here guide](README.md) first. This stage establishes the right source and migration mechanisms without guessing family relationships or publication consent.

## 1. Outcome

There is one unambiguous canonical source, protected by verified recovery copies. The source satisfies the existing graph schema. Migration preserves intended information and can be rehearsed without changing production files. Public-label decisions are recorded separately from structural repair.

Completing the tooling does not resolve an unknown source-of-truth or consent decision. Such decisions remain explicit release blockers while fixture work continues.

## 2. Inputs to inspect

| File/surface | Read for |
| --- | --- |
| `scripts/validate-family-data.mjs` | Shape, reciprocal relations, cycle/parent-count checks, topology revision |
| `scripts/generate-public-anchors.mjs` | Exact opt-in semantics and public/backend artifact shapes |
| `scripts/encrypt-family.mjs` | Current source path, version-1 envelope, command behavior |
| `scripts/local-server.mjs` | Current writable paths and payload validation |
| `scripts/apply-family-additions.mjs` | Patch source-path assumptions and stale-source checks |
| `scripts/enable-all-public-anchors.mjs` | Explicit bulk-publication behavior that must never become an automatic migration |
| `data/family.template.json` and existing fictional fixtures | Starter schema and regression examples |
| `.gitignore` | Old private file and backup exclusions |
| `docs/family-data-invariants.md` and `docs/privacy-model.md` | Existing contracts |
| Local private/encrypted/recovery files | Aggregate consistency comparison only; keep contents local |

Inventory file existence, sizes, permitted metadata, and hashes without printing readable family records. A file being newer does not prove it is the intended source.

## 3. Task DATA-01 — Capture a recoverable baseline

1. Record the code commit, dirty worktree paths, Node/platform, existing test result, and current validation result.
2. Record hashes of the existing private source and generated files in an ignored local inventory. A tracked report contains only aggregate findings and a reference to the private inventory.
3. Create a recovery directory outside every planned public-output root. Verify the resolved absolute paths before copying or deleting anything.
4. Copy the existing canonical source and the current related artifacts. Verify content hashes after the copies.
5. Keep the existing recovery ciphertext until a separately verified replacement/recovery policy exists.
6. Do not run the old repository-root server against real files while repairing these boundaries. Server checks before step 2 use isolated fictional workspaces.

Evidence: redacted baseline record plus a private verified recovery inventory. Do not claim that an ignored file is backed up by Git.

## 4. Task DATA-02 — Centralize path resolution

Create a small Node path/configuration module, suggested `scripts/lib/project-paths.mjs`.

Required responsibilities:

- Resolve a deliberate project root from module/CLI configuration rather than incidental current working directory.
- Define the canonical path `private/family.json`, recovery directories, transaction directory, public artifact paths, API generated paths, and build root.
- Permit an explicit temporary project root for integration tests.
- Distinguish read compatibility from writable authority.
- Return an actionable error when both legacy and new canonical paths exist. Never silently select by modification time.
- Keep all generated/output paths inside the configured project/test workspace.

Update script defaults together. Use `rg` to locate every `family.private.json` and backup-path assumption. User-specified file paths for legitimate CLI input are different from transaction output paths: a patch may be read from elsewhere, but output targets remain fixed and checked.

Compatibility policy:

| State | Behavior |
| --- | --- |
| New source exists; legacy source absent | Use new source |
| Only legacy source exists | Read for migration/validation; explain the migration requirement before a new write |
| Both exist | Report conflict; explicit comparison/reconciliation required |
| Neither exists | Offer documented fictional-template setup; do not create a real family source automatically |

During migration, move the old file into verified private recovery storage only after the new source and all updated readers are verified. Do not leave two live writable sources.

## 5. Task DATA-03 — Implement a minimal structural migration

Suggested module/entry points:

```text
scripts/lib/migrate-family.mjs
  inspectLegacyFamily(nodes)
  normalizeMissingRelationshipArrays(nodes)
  createMigrationReport(before, after)

scripts/migrate-family.mjs
  --dry-run
  --input <legacy-source>
  --output <new-canonical-path>
```

These names are proposed interfaces; adapt them consistently if the repository's final naming differs.

Rules:

1. Parse JSON with useful errors.
2. Clone the candidate; never mutate the caller's input.
3. Add `parents: []`, `children: []`, or `spouses: []` only when the respective property is absent from a valid relationship object.
4. Reject `null`, a string, a scalar, or other malformed populated values. An absent relationship object or ambiguous malformed structure requires inspection rather than invented family relationships.
5. Preserve IDs, person ordering/default main person, every populated relationship, supported private fields, extra retained person data, and privacy fields.
6. Run the existing strict validator on the candidate. Duplicate IDs, cycles, dangling endpoints, parent-count errors, and reciprocity errors remain failures.
7. Compute a structural diff that demonstrates no other changes occurred.
8. Make rerunning migration on normalized data a no-op.

Do not use the existing bulk anchor opt-in command as a migration shortcut. Do not derive public labels, infer consent, or infer living/deceased status.

Dry-run requirements:

- No canonical or tracked artifact replacement.
- No credential lookup or external requests.
- Aggregate output by default: people count, number of absent arrays by type, schema result, and conflict categories.
- Detailed family comparisons are written only to ignored local output when explicitly requested.

## 6. Task DATA-04 — Compare the intended snapshots

If the maintainer supplies the family password locally, decrypt the current publication into memory or protected temporary storage. Compare it with the normalized source.

Compare these dimensions separately:

| Dimension | Purpose |
| --- | --- |
| IDs and default main person | Detect missing people or a changed root |
| Relationship endpoints and reciprocity | Detect lost or contradictory family links |
| Names/dates/avatars/other retained data | Detect display-field divergence that topology hashes do not capture |
| Privacy metadata | Detect publication-policy divergence |
| Encryption envelope | Identify compatibility/corruption independently of graph differences |

Do not overwrite either source because one decrypts successfully. If differences are meaningful, record DEC-01 and obtain the owner's intended choice before real replacement. Continue fixture implementation elsewhere.

Do not ask for passwords in chat, put them in command arguments, save them in reports, or include them in exception output.

## 7. Task DATA-05 — Reconcile public anchors deliberately

The baseline has 15 tracked public anchors and zero source opt-ins after structural normalization. There are at least two possible intended outcomes: retain a deliberately reviewed subset, or publish an empty anchor catalog. The agent cannot infer which is correct.

Prepare a private review report with:

- retained, added, removed, and relabeled entries;
- whether an entry has an explicit source opt-in;
- the exact fields that would become public;
- the impact on the visual suggestion chooser and deployed backend allowlist;
- a reminder that previously published values can remain in history/caches.

Record DEC-02 without copying labels into a tracked decision file. A safe record says that a reviewed private report was approved and identifies its digest/revision; it does not duplicate family records.

When the owner resolves the choice:

1. Update only the intended source privacy fields.
2. Validate the source and public artifact schemas.
3. Generate through the common workflow when step 3 is available.
4. If implementing this stage first, stage the result privately rather than reintroducing the old independent-write paths.
5. Preserve text suggestions when the reviewed result contains no public anchors.

Never automatically empty a currently published catalog or opt every person in just to make a check pass.

## 8. Task DATA-06 — Apply migration through a verified path

Real migration occurs only after its preconditions are met: known intended source, verified recovery copies, destination path validated, script readers updated, and either the common workflow is available or a narrowly tested migration replacement is used.

For a standalone migration replacement:

1. Reject concurrent writers.
2. Prepare the candidate next to the intended target on the same filesystem.
3. Verify its JSON and strict graph validity.
4. Verify that a recovery copy matches the original.
5. Replace only the intended canonical target.
6. Read and compare the result.
7. Retire the legacy live path into private recovery storage.
8. On failure, retain the original and recovery evidence.

Do not regenerate public artifacts until the publication decision is resolved. Migration tooling can be complete while the real migration remains owner-pending.

## 9. Files expected to change

| Change | Expected files |
| --- | --- |
| Path/source resolution | New `scripts/lib/project-paths.mjs`; defaults in validation, encryption, generation, patching, opt-in migration, and local server |
| Structural migration | New migration module/CLI and fictional fixture tests |
| Private exclusions | `.gitignore` and tracking checks |
| Setup/help | README/MAINTAINER and schema/privacy docs where paths change |
| Local data | Ignored files only, after the real-data decision/preconditions |

Do not perform broad renderer/UI refactoring in this stage.

## 10. Required verification

Use matrix cases D01-D10. In particular:

- A fictional source with all required arrays is unchanged.
- A source with only missing arrays is repaired without any other field changes.
- Malformed populated relation values still fail.
- Cycles, reciprocity failures, and duplicate IDs are not "repaired" by guessing.
- Both-source conflicts stop instead of choosing a path.
- Dry runs preserve byte hashes of all live inputs/outputs.
- Privacy metadata and main-person order survive.
- Legacy/new path behavior works from a different current working directory.
- Private/recovery files are ignored and are rejected if already tracked.
- Real-data reconciliation has an explicit owner record before publication.

Run the existing family-validation, generation, and migration tests together after changing their shared contracts. Do not count fixture success as proof the real family source is reconciled.

## 11. Exit and handoff

Stage 1 mechanism exit:

- Migration/path tooling exists and relevant tests pass.
- No information-losing normalization is used.
- The intended real migration/reconciliation state is recorded truthfully.
- No unrelated tracked artifact changed.
- Stage 2 has stable path and source-resolution contracts.

Handoff:

```text
Stage: 1
Tasks verified:
Code paths changed:
Fixture case results:
Real source status: not touched / reconciled / decision-pending
Publication consent status:
Recovery copy verified: yes/no; private location reference only
Outstanding DEC IDs:
Next action: step 2 restricted assembly and HTTP boundary
```

## 12. Agent assignment prompt

> Implement step 1 of the personal-edition agent playbook. Preserve and inventory the current worktree and family artifacts without exposing their contents. Add centralized paths, a strict minimal structural migration, and fictional-data tests. Compare real snapshots only through local secret handling. Do not infer publication consent or run real-data replacement while DEC-01/DEC-02 remain unresolved. Complete all independent mechanism work and record the exact handoff for step 2.
