# Guest Visual Suggestions

## Phase 3 scope

The guest visual workspace builds an additive proposal around one approved
public anchor, previews it, and submits the structured graph to the write-only
suggestions API. It never reads the protected canonical tree.

The two guest modes remain independent:

- **Simple form** sends the existing text payload to the configured suggestions
  API and still requires the submission access code.
- **Visual tree** creates a structured graph preview, then asks for submitter
  details and the separate submission access code before an explicit POST.

## Data boundary

Visual mode requests only `data/family.anchors.public.json`. The encrypted
canonical payload is loaded lazily only after a family-password unlock attempt.
Visual modules contain no canonical save or family-authentication capability.
The submission module knows only the configured HTTPS suggestions endpoint.

The selected anchor object is one of the frozen, schema-checked public catalog
records. Its id and reviewed labels are the only canonical values passed to the
visual renderer.

## Authoritative draft model

`assets/suggestions/draft-model.js` owns the proposal. Family Chart receives a
derived array on each render and is never treated as persisted draft state.

The authoritative draft serialization is:

```json
{
  "schemaVersion": 1,
  "type": "graph",
  "anchorPersonId": "approved-anchor-id",
  "anchorCatalogVersion": "sha256:...",
  "sourceRevision": "sha256:...",
  "people": [],
  "relationships": []
}
```

Proposed people use deterministic `tmp_1`, `tmp_2`, ... ids and support only
`firstName`, `lastName`, `birthday`, and `gender`. Relationships support only
directional `parentOf` and normalized, undirected `spouseOf` records.

## Enforced invariants

The model rejects anchor edits/removal, user-entered ids, unsupported fields,
self/duplicate/dangling relationships, unknown canonical ids, disconnected
proposed people, ancestry cycles, more than two proposed parents, more than 50
people, and more than 100 relationships. Removing a proposed person requires
explicit cascade confirmation when it would detach a temporary subgraph.

## Rendering and escaping

`assets/suggestions/graph-adapter.js` converts the draft to temporary Family
Chart nodes with reciprocal `parents`, `children`, and `spouses` arrays. The
renderer receives only the anchor and temporary people. Card HTML is generated
with explicit escaping for every label; no user avatar or arbitrary HTML field
exists.

## Submission boundary

`assets/suggestions/submission-api.js` projects only the authoritative graph
fields into the request, then adds the submitter's name, email, relationship,
optional comment, and access code. Family Chart state and browser session state
are not accepted as request inputs. The access code is not placed in the draft
or browser storage.

Lambda independently validates the complete graph, checks the access code,
requires the deployed catalog version, and requires the anchor id to occur in
the generated backend allowlist. Frontend validation is a UX guard, not an
authorization boundary.

After a successful response the draft and access code are cleared. A failed
request preserves the graph and non-secret contact fields for retry while
clearing the access-code input.

## Additive-only request

The graph request can contain only proposed temporary people and `parentOf` or
`spouseOf` relationships. There are no update, delete, replace, detach, patch,
status, or timestamp fields. The selected canonical id is immutable and is the
only canonical endpoint allowed.
