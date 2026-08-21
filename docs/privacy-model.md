# Privacy Model and Public Anchors

## Protected information

The normal family-tree viewer continues to publish only an AES-GCM encrypted
canonical payload. Apart from deliberately opted-in anchor ids and reviewed
labels in the separate public catalog, canonical names, birthdays, avatars,
ids, additional data fields, and relationship topology remain encrypted until
the family password decrypts them in the visitor's browser.

The complete canonical tree is not a guest data source.

Hiding a field with CSS or rendering a private card would not provide privacy:
if the underlying JSON were public, a visitor could inspect the network
response or page JavaScript. Public information must therefore be generated as
a separate minimal artifact.

## Explicit opt-in metadata

Publication is per-person and explicit:

```json
{
  "privacy": {
    "publicAnchor": false,
    "publicLabel": "",
    "publicLifespan": "",
    "publicBranchLabel": ""
  }
}
```

Rules:

- Missing `privacy` means not public.
- Missing `publicAnchor` means not public.
- Only the exact boolean value `true` opts a person in.
- An opted-in person requires a non-empty, manually reviewed `publicLabel`.
- Lifespan and branch labels are optional and are published only when their
  explicit privacy fields contain non-empty strings.
- Living/deceased status is never inferred.
- The artifact generator never derives labels from private names or birthdays;
  it copies only explicit `privacy` values.
- Private avatar and relationship data are never copied.
- Opting a person in deliberately publishes that person's stable canonical id
  together with the reviewed labels.

The reviewed label may intentionally equal a private name, but that is an
explicit publication decision rather than an artifact-generator inference.

This repository also includes `npm run enable:all-anchors`, an explicit local
bulk migration for a maintainer who has deliberately decided to publish every
canonical member as an anchor. It derives `publicLabel` from the canonical
display-name fields and, because the current UI already displays `birthday`,
copies a non-empty birthday into `publicLifespan`. It leaves branch labels empty
unless an already reviewed privacy value exists. The migration touches only the
ignored private source, validates before and after, and must be reviewed before
generated artifacts are committed.

## Public catalog

Generate both artifacts from the same private source:

```bash
npm run generate:anchors
```

The frontend catalog is `data/family.anchors.public.json`:

```json
{
  "schemaVersion": 1,
  "catalogVersion": "sha256:...",
  "sourceRevision": "sha256:...",
  "anchors": [
    {
      "id": "person-123",
      "displayLabel": "Reviewed public label",
      "lifespanLabel": "Optional reviewed text",
      "branchLabel": "Optional reviewed branch"
    }
  ]
}
```

The backend allowlist artifact is
`api/generated/public-anchor-allowlist.json`:

```json
{
  "catalogVersion": "sha256:...",
  "anchorIds": ["person-123"]
}
```

The submission Lambda loads this allowlist to reject arbitrary canonical ids.
It also rejects a graph whose `anchorCatalogVersion` differs from this artifact.

## Catalog version

`catalogVersion` is a domain-separated SHA-256 digest of exactly:

- public catalog schema version `1`;
- the deterministically id-sorted public anchor objects;
- only `id`, `displayLabel`, and non-empty optional public labels.

It excludes `sourceRevision`. Therefore private graph changes do not change the
catalog version unless the public catalog itself changes.

Visual drafts preserve both revisions. Graph submissions send them so Lambda
can enforce the catalog version. Lambda stores `sourceRevision` for later admin
review but intentionally cannot compare it with the private canonical source.

`sourceRevision` is documented in `family-data-invariants.md`. It identifies
merge-relevant canonical graph state and will later be used during review and
safe patch export.

## Opting a person in

1. Open local `data/family.private.json`.
2. Add a `privacy` object to the intended person.
3. Set `publicAnchor` to `true`.
4. Write a deliberately reviewed `publicLabel`.
5. Add only optional public labels you intend everyone to see.
6. Run `npm run generate:anchors`.
7. Inspect both generated JSON files.
8. Run `npm run validate` before publishing.

## Removing a person

1. Set `privacy.publicAnchor` to `false`, or remove the `privacy` object.
2. Run `npm run generate:anchors` again.
3. Confirm the id is absent from both generated files.
4. Run `npm run validate`.

Previously published information may remain in Git history, browser caches, or
third-party archives. Removing an anchor prevents future publication but
cannot guarantee erasure of previously public values.

## CI without private production data

CI never needs `data/family.private.json`. It validates fixtures, the tracked
fictional template, generated artifact schemas, catalog/allowlist agreement,
and public runtime configuration. When the real private file exists locally,
the same public-build command additionally verifies artifact freshness and
scans tracked files for private-name leakage.
