# Step 5 — Repair editing and review behavior

Task range: `UI-01` through `UI-07`. Verification cases: `U01` through `U14`.

Read the [start-here guide](README.md) and the HTTP/workflow/configuration handoffs. This stage repairs observable behavior without redesigning the product or replacing the chart library.

## 1. Outcome

The browser distinguishes what is saved, what is being edited, and what an optional service is doing. Failures retain the user's work. Lock clears decrypted content and privileged review state. Suggestion acceptance, patch download, local application, and publication are visibly separate actions.

## 2. Current code to trace

| Source | Relevant behavior |
| --- | --- |
| `assets/app.js` | Boot order, unlock, session restore, chart rendering, edit/discard/save, payload cache |
| `assets/suggestions/visual-editor.js` | Draft lifecycle, submit confirmation, API success/failure |
| `assets/suggestions/draft-model.js` | Authoritative proposed-branch state |
| `assets/suggestions/graph-adapter.js` | Cloned/escaped chart presentation |
| `assets/admin/review-workspace.js` | Auth initialization, cached currentRevision, list/detail, accept/download |
| `assets/admin/auth-client.js` | PKCE, session lifetime, token storage, redirect cleanup |
| `assets/admin/api-client.js` | Configured URL/token boundary |
| `index.html` and `assets/app.css` | Existing dialog, toolbar, status, and responsive contracts |

Do not change vendored chart files as the first response to an application-state bug. Wrap/clone/adapt at the application boundary where possible.

## 3. Task UI-01 — Establish a small explicit state model

Suggested responsibility split:

```text
assets/app.js                         composition and page wiring
assets/viewer/session-state.js         locked/unlocked and current payload association
assets/viewer/chart-adapter.js         presentation clones and safe card formatting
assets/editor/editor-state.js          saved snapshot, working draft, dirty state
assets/editor/local-api.js             handshake, CSRF, save/result protocol
assets/editor/editor-controller.js     edit/discard/save/review-publication transitions
```

Create only modules needed to make these boundaries clear and testable. Keep suggestions/admin modules as separate features.

Minimum state responsibilities:

- `savedNodes` is the last confirmed persisted canonical snapshot.
- `draftNodes` is a separate editable clone.
- Chart data is a presentation/export boundary, not the authoritative persisted model.
- The loaded encrypted payload digest/snapshot and full local saved revision are retained together.
- The current password exists only in memory while the local session is unlocked.
- Async requests carry a session generation/abort signal so old callbacks cannot repopulate a locked screen.

Recommended main states:

| State | Allowed actions | Important rule |
| --- | --- | --- |
| Locked | Unlock, configured guest suggestions | No decrypted tree displayed/cached |
| Unlocked read-only | Navigate, Lock, configured suggestions/review | No local editing merely because UI controls are visible |
| Local clean | Enter Edit, inspect saved tree | Known local protocol and fresh unlock required |
| Editing clean | Change cards, Discard | Saved snapshot remains unchanged |
| Editing dirty | Save, Discard, continue editing | Leaving requires an explicit discard choice |
| Preparing/saving | Await or cancel only where safe | Prevent duplicate mutations or moving candidate approval |
| Publication review | Confirm exact prepared changes or cancel | Approval binds to one candidate/base revision |
| Conflict | Keep draft, inspect/reload deliberately | No automatic overwrite/merge |
| Recovery required | Inspect recovery guidance | Further writes disabled |

Use ordinary modules/data objects; a state-management framework is not required.

## 4. Task UI-02 — Fix bootstrap, unlock, and session cleanup

Bootstrap:

1. Collect required elements and bind basic controls synchronously.
2. Initialize safe configuration/capabilities.
3. Start optional admin initialization independently with bounded error handling.
4. Discover local save support only for the valid local runtime.
5. A failed optional task must not prevent unlock form submission.

Unlock:

- Validate the encryption envelope before expensive decryption.
- Keep wrong-password/corrupt-payload failures in the locked state.
- Associate the displayed nodes with the actual encrypted snapshot that was loaded.
- Reset any previous session's outstanding work before showing a different payload.
- Distinguish an unavailable payload from wrong credentials without disclosing private data.

Reload policy:

- Recommended default: decrypted tree/draft data stays in memory.
- Remove the legacy plaintext `family-tree-session-v1` cache and stop writing full nodes to browser durable/session storage.
- Reload requires a fresh unlock; it must not turn an unsaved draft into the saved baseline.
- Record DEC-03 if the owner requires a different policy. Do not invent an autosave feature as part of this repair.

Lock:

- Abort pending optional requests or invalidate their callbacks.
- Clear password references, decrypted nodes, draft/saved clones, admin selected details, patch preview, chart DOM, and relevant cached privileged state.
- Clear the administrator's existing local session through its supported API.
- Keep guest-submission credentials confined to their dialog/request boundary.
- Return focus to the unlock control.

JavaScript memory cannot be promised to be securely zeroized. The requirement is correct reference/storage/DOM lifecycle, not a claim of guaranteed memory erasure.

## 5. Task UI-03 — Preserve editing, export, and Discard semantics

Keep the familiar two-level workflow:

1. A card's Save updates the in-memory draft.
2. The page-level Save persists the whole session through the common service.

Rules:

- Enter Edit starts from a clone of the last saved snapshot.
- Person/card cancel does not mutate the saved canonical model.
- Normalize known chart export omissions and renderer flags without losing privacy or extra retained fields.
- Detect dirty state semantically; chart-only transient changes should not make a canonical save necessary.
- Discard restores the last confirmed saved snapshot and resets the chart/editor.
- Do not announce a successful disk save merely because a card form closed.
- Prevent or explicitly confirm Lock/dialog close/navigation when it would abandon dirty canonical work.
- Use `beforeunload` only as best-effort protection; browser crashes and some mobile exits can still lose unsaved edits.

Do not add full offline synchronization, background canonical autosave, or automatic conflict merging to this release.

## 6. Task UI-04 — Implement the protected save and result flow

Before saving:

- Verify the exact local protocol/capability response.
- Require the loaded snapshot/revision association and fresh in-memory credential.
- Use the local API client's per-process token.
- Assign one operation ID to the candidate and its transport retries.
- Freeze or invalidate the candidate if editing continues while a prepared publication approval is open.

Request flow:

```text
Draft -> local prepare/commit request
  -> validation error: keep draft and show actionable safe message
  -> public metadata changed: show exact local preview
       -> cancel: keep draft, no canonical commit
       -> confirm matching candidate: protected commit
  -> stale snapshot: keep draft, enter conflict state
  -> recovery required: keep draft, disable writes
  -> committed receipt: update saved snapshot/revisions and rebuild chart
```

After confirmed success:

- Set `savedNodes` from the committed result/verified candidate.
- Clear dirty state only after committed success.
- Invalidate the old encrypted-payload promise/cache and old review metadata.
- Refresh the local snapshot association for later saves.
- Tell the maintainer that changes are saved locally and publication is a later action.

On transport ambiguity, consult the safe operation receipt/status or retry the same operation ID. Do not create a new operation blindly or label the operation definitely failed when it may have committed.

Suggested error behavior:

| Code/category | Message/action |
| --- | --- |
| Canonical validation | Explain the actionable relation/field issue locally; keep the draft |
| Invalid local token/server restarted | Refresh local capability, then recheck snapshot before retry |
| Wrong current credential | Require a deliberate fresh unlock; do not rotate the password |
| Stale snapshot | Another save changed the tree; preserve draft, offer explicit reload/discard |
| Publication confirmation expired | Reprepare and show the current public diff |
| Recovery required | Show the recovery command/instructions; disable writes |
| Optional suggestion API failure | Keep its draft and separate this from canonical save status |

Do not show raw server traces or private request bodies.

## 7. Task UI-05 — Make administrator review current and repeatable

### Review context

The graph preview must identify the saved canonical snapshot it uses. Unsaved local edits must not silently become the "Original" reference for a patch against published metadata.

Recommended simple policy:

- Permit browsing suggestions while a canonical draft is dirty.
- Use the saved snapshot for Original/Overlay.
- Disable graph acceptance/export when unresolved local edits make the intended base ambiguous, and explain Save/Discard first.
- Revalidate current published metadata before acceptance/export.

### Metadata lifetime

The existing indefinitely cached `currentRevision` needs an explicit invalidation policy.

Invalidate/reload when:

- a local canonical operation commits;
- the tree is locked/unlocked into a different snapshot;
- the administrator refreshes or selects a new review operation requiring current metadata;
- the backend reports a stale revision.

Do not suppress a real frontend/backend version mismatch. Explain that the paired release may be pending.

### Acceptance and download

1. Prepare the deterministic patch against the current allowed base.
2. Submit the review decision through the authenticated admin API.
3. Report the resulting review status accurately.
4. Attempt the patch download.
5. Offer "Download patch again" independently of another status mutation.

If acceptance succeeds and download fails, show "Accepted; download needs retry" rather than pretending acceptance failed. Repeat download must not send another PATCH request.

Keep source/catalog checks in the local applicator as the final authority. A previously accepted patch may later become stale.

### Authentication

- Keep Cognito login independent from the family password and guest access code.
- Preserve existing PKCE/state/nonce protections and short-lived token behavior.
- After 401/403, clear expired local admin credentials and show sign-in.
- Lock must prevent late responses from redisplaying authorized-only details.
- Do not add canonical write permissions to the admin Lambda.

## 8. Task UI-06 — Preserve guest drafts and safe rendering

Simple/visual suggestions:

- Configured availability is explicit; absent config makes no network call.
- With zero public anchors, keep the simple form and explain the unavailable visual chooser.
- No guest draft loads the private canonical source or inherits decrypted viewer nodes.
- The access code enters only the explicit submission request and transient dialog controls.
- Failed/timeout/stale submissions keep the proposed branch.
- Reset the draft only after confirmed server success or deliberate discard.
- Handle repeated clicks and late responses without duplicate submissions or resetting a new draft.

Rendering inspection:

- Use text nodes/escaping for canonical, proposed, review, and error text.
- Exercise fictional names containing HTML-like content and quote characters.
- Validate avatar URL handling before inserting it into generated card HTML; use documented safe schemes and never raw attribute concatenation.
- Preserve needed chart functionality while fixing a confirmed rendering defect.
- Label inspection results accurately; do not claim an injection vulnerability solely because a renderer uses HTML.

## 9. Task UI-07 — Verify supported interaction paths

Desktop maintainer checks:

- Fresh unlock -> Edit -> card Save -> page Save -> Lock -> fresh unlock reflects saved data.
- Edit -> Discard restores the persisted version.
- Two-tab stale edits preserve the second draft.
- Wrong password, invalid canonical candidate, restarted server, and unavailable disk show distinct useful states.
- Public-label preview cannot approve a different candidate.
- Administrator acceptance/re-download/rejection and expired sign-in work without canonical mutation.

Phone/keyboard checks:

- Unlock and chart navigation remain usable at the minimum supported phone width.
- Suggestion dialogs can be opened, navigated, submitted, and closed.
- Dialog focus is trapped appropriately and returns to the trigger.
- Status changes are announced without moving focus unexpectedly.
- Errors are associated with the relevant controls.
- Touch targets and scroll containment work in both orientations where supported.

Use fictional data and fake services. During implementation, use the T3 shared preview according to active tool instructions for manual browser verification.

## 10. Scope limits

Do not replace the visual design, translate the whole UI, introduce a new graph library, or turn the personal viewer into a customer platform. A narrowly necessary accessibility/layout fix is appropriate when a required journey fails.

Do not change the backend review schema to add "applied" or "published" statuses merely to improve the labels. Explain the current distinct operations with accurate UI copy and a local operation receipt.

## 11. Exit and handoff

- Saved/draft/presentation state are distinct.
- Failed or ambiguous saves do not silently discard work.
- Reload cannot relabel an unsaved draft as saved.
- Lock and async responses respect the session boundary.
- Review metadata is current at the decision/export boundary.
- Patch re-download is independent of status updates.
- Guest/private credentials and datasets remain separated.
- Required desktop/phone/keyboard journeys have evidence.

## 12. Agent assignment prompt

> Implement step 5 of the personal-edition agent playbook. Repair bootstrap, memory/session lifecycle, saved-versus-draft state, protected save outcome handling, and explicit conflict/recovery states. Keep the existing card/page save workflow and visual design. Make administrator metadata current, distinguish acceptance from download/application/publication, and add repeatable patch download. Preserve guest drafts and data boundaries, inspect safe rendering, and verify the required journeys with fictional data and local fake services.
