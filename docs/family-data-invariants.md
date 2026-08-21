# Canonical Family Data Invariants

## Source of truth

`data/family.private.json` is the only readable canonical source of truth. It is
ignored by Git. `data/family.enc.json` is a generated encrypted representation
for the protected GitHub Pages viewer.

The validator never repairs data. It reports every actionable issue it can
find, and the caller must correct the canonical source before encryption or
local save can continue.

Run it directly with:

```bash
npm run validate:family
```

## Canonical person shape

Each person is an object with a stable canonical id, data fields, and three
explicit relationship arrays:

```json
{
  "id": "person-123",
  "data": {
    "first name": "First",
    "last name": "Last",
    "birthday": "2000",
    "avatar": "",
    "gender": "F"
  },
  "rels": {
    "parents": [],
    "children": [],
    "spouses": []
  }
}
```

All three relationship keys are required, including when their arrays are
empty. Family Chart omits empty arrays when it exports data, so the frontend
normalizes that library output at the serialization boundary before local
save. The canonical validator itself does not normalize or mutate input.

The currently supported gender convention is `"M"` or `"F"`. The known
display fields `first name`, `last name`, `birthday`, and `avatar` must be
strings when present. Additional private `data` fields are retained and are
not published by the anchor generator.

## Stable ids

- Every canonical id must be a unique, non-empty string.
- Leading or trailing whitespace is invalid.
- Never rename an id merely to change a displayed name.
- The `tmp_*` namespace is reserved for unsubmitted visual-suggestion drafts
  and is forbidden in canonical data.
- Relationship arrays always contain canonical ids, never screen coordinates
  or names.
- The first array entry is the renderer's default main person unless a caller
  explicitly supplies another existing main id.

## Relationship semantics

Parent and child relationships are two representations of the same edge and
must be reciprocal:

```text
parent.rels.children includes child.id
child.rels.parents includes parent.id
```

Spouse relationships must also be reciprocal:

```text
personA.rels.spouses includes personB.id
personB.rels.spouses includes personA.id
```

Siblings are derived from shared parents; there is no canonical `siblings`
array. The current renderer assumes no more than two parents per person.

## Enforced graph rules

The validator rejects:

- an empty or non-array canonical root;
- missing, blank, duplicate, or temporary ids;
- missing/non-array relationship collections;
- duplicate ids inside a relationship array;
- dangling endpoints;
- self-parent, self-child, and self-spouse references;
- one-sided parent/child or spouse relationships;
- ancestry cycles;
- more than two parents;
- renderer-internal temporary fields in persisted people;
- malformed publication metadata;
- a configured main person that does not exist.

## Source revision

`sourceRevision` is deterministic and formatted as `sha256:<hex>`.

It hashes a domain-separated, normalized projection containing only:

- schema version `1`;
- default/configured main person id;
- sorted canonical person ids;
- each person's sorted `parents`, `children`, and `spouses` ids.

Names, birthdays, avatars, extra private data fields, and publication labels
are deliberately excluded. The output reveals no plaintext values, but it is
a public fingerprint of the merge-relevant ids and topology. It changes when
the canonical graph changes and will later prevent applying a reviewed patch
against stale relationship state.

The same generator writes `api/generated/canonical-revision.json`, containing
only schema version, `catalogVersion`, and `sourceRevision`. The admin Lambda
uses this generated fingerprint to block stale graph acceptance. It does not
receive the private canonical array.

## Workflow integration

- `scripts/encrypt-family.mjs` validates before writing encrypted output.
- `scripts/local-server.mjs` parses and validates both submitted files before
  replacing either target. Both temporary files are fully written before
  replacement starts.
- `scripts/generate-public-anchors.mjs` validates before generating public
  artifacts and the backend-only revision fingerprint.
- `scripts/apply-family-additions.mjs` validates a downloaded additions-only
  patch against the current source revision, validates the resulting family,
  creates an ignored plaintext backup, and regenerates encrypted/public
  artifacts. It has no commit or push behavior.
- `scripts/validate-public-build.mjs` validates real private data when it is
  available and uses the tracked fictional template for CI-safe structural
  checks when it is not.
