# Encrypted Family Tree

Static family tree viewer for GitHub Pages with:

- a public read-only site
- encrypted family data
- local editing on `localhost`
- direct save back into the repo for GitHub Desktop workflows

## What It Is

This project publishes a family tree as a lightweight static site.

The public site contains only:

- the HTML/CSS/JS shell
- the encrypted data payload
- the deliberately published minimal anchor catalog (ids and reviewed labels,
  without family relationships or arbitrary canonical fields)

The readable family data lives only in a local file that is ignored by git.

## Core Idea

- GitHub Pages stays read-only.
- Editing happens only on your local machine.
- The browser decrypts the tree after unlock.
- When running locally, `Save` writes directly into the repo.
- GitHub Desktop then sees the changed files, and you push normally.

## Project Files

- `index.html`: public page shell
- `assets/`: local styles, app logic, and vendored chart assets
- `data/family.enc.json`: encrypted payload that gets committed
- `data/family.private.json`: local plaintext data source, gitignored
- `data/family.template.json`: tracked starter template for creating your own version
- `data/family.anchors.public.json`: generated, privacy-reviewed public anchor catalog
- `api/generated/public-anchor-allowlist.json`: matching backend anchor-id allowlist
- `scripts/local-server.mjs`: local server with direct save API
- `scripts/encrypt-family.mjs`: encrypts the private JSON into the public payload
- `scripts/validate-family-data.mjs`: validates canonical ids and graph invariants
- `scripts/generate-public-anchors.mjs`: generates both public anchor artifacts
- `scripts/enable-all-public-anchors.mjs`: explicit local bulk opt-in migration
- `scripts/validate-public-build.mjs`: checks tracked files for plaintext leaks
- `assets/suggestions/`: local guest visual-draft model, public catalog loader,
  Family Chart adapter, and visual workspace controller

## Make Your Own Version

1. Clone this repo.
2. Copy `data/family.template.json` to `data/family.private.json`.
3. Replace the template people with your own family data.
4. Choose your own shared password locally.
5. Generate the encrypted payload:

   ```powershell
   $env:FAMILY_TREE_PASSWORD="choose-your-own-password"
   npm run encrypt
   npm run generate:anchors
   npm run validate
   ```

6. Publish the repo with GitHub Pages.

## Local Editing

Start the local server:

```powershell
npm run local
```

Then open:

```text
http://127.0.0.1:4173
```

Local workflow:

1. Unlock the tree.
2. Click `Edit`.
3. Save each edited card inside the modal.
4. Click the page-level `Save` once when the full session is ready.
5. Run `npm run generate:anchors` after id, relationship, or public-anchor changes.
6. Run `npm run validate` and inspect every generated public value.
7. Commit and push with GitHub Desktop.

That local `Save` writes directly to:

- `data/family.private.json`
- `data/family.enc.json`

Public anchor generation additionally writes:

- `data/family.anchors.public.json`
- `api/generated/public-anchor-allowlist.json`

## Manual Editing

If you prefer editing data directly, change `data/family.private.json` and then run:

```powershell
$env:FAMILY_TREE_PASSWORD="choose-your-own-password"
npm run encrypt
npm run generate:anchors
npm run validate
```

## Data Shape

Each person is one object in the array.

- `data`: person fields
- `rels`: relationships to other ids

Example:

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
    "parents": ["parent-1", "parent-2"],
    "children": ["child-1"],
    "spouses": ["spouse-1"]
  },
  "privacy": {
    "publicAnchor": false,
    "publicLabel": "",
    "publicLifespan": "",
    "publicBranchLabel": ""
  }
}
```

All three relationship arrays are required, including when empty. Public
anchors are explicit opt-in and publish only reviewed values from `privacy`.
See `docs/family-data-invariants.md` and `docs/privacy-model.md`.

## Guest Suggestions

`Suggest a correction` offers two independent modes:

- `Simple form` preserves the existing access-code-protected text submission.
- `Visual tree` builds and previews an additive branch locally around one
  approved public anchor, then submits the structured graph after an explicit
  confirmation and separate access-code step.

The visual workspace never loads the private canonical source or decrypts the
protected tree. See `docs/visual-suggestions.md` for its schema and security
boundary.

## Notes

- This is privacy for trusted sharing, not strong server-side security.
- Do not commit `data/family.private.json`.
- Do not edit `data/family.enc.json` manually.
- `sessionStorage` is used only for the current browser session.

## Maintenance

See `MAINTAINER.md` for the operational workflow, validation checklist, and customization notes.

## Optional Guest Suggestions

The core site is static and read-only. An optional AWS SAM stack can collect
guest suggestions without exposing the private family data or changing the
local editing workflow. See `docs/suggestions-api.md` for deployment,
configuration, security boundaries, and operational notes.
