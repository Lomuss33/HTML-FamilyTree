# Agent progress and handoff templates

These are blank templates for future implementation work. They do not mark a task started, a decision approved, or a deployment authorized.

Use the [start-here guide](README.md) and [verification matrix](verification-matrix.md). Keep tracked records redacted.

## 1. Implementation progress record

Suggested tracked destination when work begins: `docs/personal-edition-repair-progress.md`.

```markdown
# Personal edition repair progress

Implementation started:
Current code revision/branch:
Current stage:
Owner objective:
Last handoff update:

## State summary

Implemented:
Verified:
Real-data reconciliation:
Live deployment:
Current blocker:
Next useful independent task:

## Stage status

| Stage | Status | Verified case IDs | Remaining decisions | Next action |
| --- | --- | --- | --- | --- |
| 1. Preserve/repair data | not-started | | | |
| 2. Secure local access | not-started | | | |
| 3. Unify saving/recovery | not-started | | | |
| 4. Publication/config | not-started | | | |
| 5. Editing/review | not-started | | | |
| 6. Verify/release | not-started | | | |

## Current worktree

User changes preserved:
Agent changes:
Untracked documentation/artifacts:
Private files touched: yes/no; describe operation class only

## Latest evidence

Command/procedure:
Platform/runtime:
Relevant case IDs:
Result:
Evidence reference:

## Resume instructions

Read next:
Inspect before writing:
Exact next task:
Dependent operation to avoid until resolved:
```

Do not populate a template field with a real password, person name/ID, canonical JSON, public-label approval list, or full private file path where a neutral reference suffices.

## 2. Individual task card

```markdown
### Task ID — Concrete behavior

Status: not-started
Stage:
Why this task exists:
Prerequisites:

Read first:
Expected files:

Implementation:
1.
2.
3.

Behavior to preserve:
Error/failure behavior:
Verification case IDs:
Actual checks/results:

Owner decision dependency:
Public/private data handling:
Known limitation:
Completion evidence:
Next handoff:
```

A task is not verified just because its code diff looks plausible. Record the relevant observed behavior.

## 3. Stage handoff

```markdown
## Stage handoff

Stage:
Tasks completed:
Tasks implemented but unverified:
Decision-pending tasks:

Changed behavior:
Changed file/module boundaries:
Interfaces handed to the next stage:
Compatibility kept or deliberately changed:

Checks run:
Relevant case IDs:
Platform/browser results:
Known failing checks:

Real source status:
Public consent status:
Recovery status:
Production configuration/resources touched:

Safe next action:
What the next agent must inspect first:
```

If a stage is blocked on real data, hand off the completed fixture mechanism and describe precisely which live operation remains blocked. Avoid a blanket "everything blocked" when useful implementation can continue.

## 4. Owner decision record

```markdown
## Decision DEC-__

Question:
Why it affects the implementation/release:
Concrete reviewed report reference:
Report/source revision or digest:
Owner response:
Response recorded at:
Scope of authorization:

May proceed:
Still unresolved:
```

For public-label review, keep the actual reviewed labels in ignored private storage. The tracked record identifies the report digest/scope without repeating the family data.

An unanswered question remains unanswered. A recommended default is not evidence of approval for a new public disclosure.

## 5. Safe implementation verification record

```markdown
## Verification

Case IDs:
Implementation/code version:
Fixture/test/procedure:
Command:
Platform/runtime/browser:
Expected observable result:
Actual result:
Evidence:
Limitations:
Retest required after:
```

Use fictional values in all shared evidence. Save detailed real-source comparisons only in ignored local records, and avoid attaching them to a PR.

## 6. Failure and recovery record

```markdown
## Recovery incident/rehearsal

Operation ID:
Environment:
Injected or actual failure:
Last known verified transaction state:
Live artifact set status:
Further writes blocked: yes/no
Recovery evidence preserved: yes/no

Inspection performed:
Chosen recovery action:
Previous coherent set verified:
New committed set verified:
Result:
Unresolved problem:
Next safe step:
```

Do not copy transaction payloads or credentials into the tracked report. A failed rollback must remain visible as unresolved until verification proves recovery.

## 7. Release candidate record

```markdown
# Personal edition release candidate

Code revision:
Prepared local operation:
Public site artifact digest:
Catalog version:
Source revision:
API generated artifact/package reference:
Intended environment/base path:

Canonical reconciliation: pass/fail/pending
Public-label review: pass/fail/pending
Required local/CI cases:
Windows results:
Ubuntu results:
Browser/device results:
Separate encrypted-backup restoration:
Known limitations:

Website deployment: not-requested/pending/deployed/verified
API deployment: not-requested/pending/deployed/verified
Selected AWS Region confirmed:
AWS plan/spend status checked:
Pages source/workflow checked:
Live smoke results:
Rollback artifact pair:

Release blockers:
Actual release status:
```

This record contains different versions because code, local canonical content, a site artifact, and deployed API metadata can advance separately. Do not collapse them into one vague "latest" state.

## 8. Final user handoff

Suggested structure:

1. Lead with what now works and what remains incomplete.
2. Link the relevant code/runbook/progress record.
3. Summarize meaningful verification by platform and workflow.
4. State real-data and public-label reconciliation status.
5. State whether anything was actually deployed.
6. Explain any concrete blocker and the smallest next required decision.
7. Keep commercial/mobile work outside the completion claim.

Avoid reporting a locally tested candidate as a production release. Avoid presenting an estimate, a recommended default, or a prepared template as work already performed.

## 9. Ready-to-use all-stage implementation request

> Implement the personal-edition repair described in docs/personal-edition-agent-plan/README.md and all six linked stages. Read the current AGENTS.md and preserve existing worktree changes. Maintain a redacted progress record and map verification to the matrix. Start with fictional fixtures and proceed through data preservation, local HTTP protection, the common save/recovery workflow, publication/configuration, UI/review reliability, and cross-platform verification. Resolve actual owner source/publication decisions before dependent real-data changes, and perform no unrequested live deployment. Continue useful independent work while a decision is pending. Finish with tested runbooks, a restore rehearsal, and an accurate implemented/local/live/release handoff.

The user may adapt the final sentence to explicitly request a release or limit the scope. Active session authorization takes precedence over this suggested text.
