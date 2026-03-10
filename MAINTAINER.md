# Maintainer Guide

## Purpose

This repository is designed for one maintainer workflow:

- keep the published site read-only
- edit locally
- save directly into the repo
- commit and push with GitHub Desktop

## Daily Workflow

1. Start the local app:

   ```powershell
   npm run local
   ```

2. Open `http://127.0.0.1:4173`.
3. Unlock the tree with the current shared password.
4. Click `Edit`.
5. Save card changes inside the modal as you work.
6. Click the page-level `Save` when the full session is done.
7. Check the changed files in GitHub Desktop.
8. Commit and push.

## Files That Matter

- `data/family.private.json`
  This is the local plaintext source of truth.

- `data/family.enc.json`
  This is the encrypted public payload that gets committed.

- `data/family.template.json`
  Use this when creating a new family tree from scratch.

## Rotating The Shared Password

To change the shared password:

1. Keep `data/family.private.json` as the source of truth.
2. Choose the new password locally.
3. Re-encrypt the payload:

   ```powershell
   $env:FAMILY_TREE_PASSWORD="choose-a-new-password"
   npm run encrypt
   npm run validate
   ```

4. Commit and push the updated `data/family.enc.json`.

Important:

- Never store the shared password in tracked files.
- Never put the shared password in the README or commit messages.

## Creating A New Fork Or Family Version

1. Copy `data/family.template.json` to `data/family.private.json`.
2. Replace all template people with your own structure.
3. Encrypt with your own shared password.
4. Validate.
5. Publish.

## Validation Checklist

Run before pushing:

```powershell
npm run validate
```

This checks tracked files for leaked plaintext values from the private dataset.

## Local Server Notes

- `scripts/local-server.mjs` serves the app on `127.0.0.1:4173`.
- It also exposes `/api/save`.
- That endpoint writes directly into `data/family.private.json` and `data/family.enc.json`.
- This direct save path is intentionally local-only.

## Customization Notes

- UI layout and styling live in `assets/app.css`.
- Tree behavior and local editing flow live in `assets/app.js`.
- The page shell lives in `index.html`.
- Encryption format is defined by `scripts/encrypt-family.mjs`.

## Safety Rules

- Do not commit `data/family.private.json`.
- Do not paste real family names into tracked docs.
- Do not edit the encrypted file manually.
- Keep UTF-8 encoding for names with accents or special characters.
