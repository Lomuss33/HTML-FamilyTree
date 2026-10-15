# Personal Family Archive

A small personal family tree: one local administrator edits the canonical tree,
trusted visitors unlock an encrypted read-only copy, and optional guest
suggestions wait for review.

The public/mobile commercial product remains a separate future project. This
edition has no billing, public accounts, or automatic cross-family merges.

## Continue with the repaired tree

The chosen local source has been preserved in ignored `private/family.json`.
Missing relationship arrays were repaired and the existing 15 public labels were
reconciled exactly. The original encrypted payload is preserved until you enter
the current family password locally.

```powershell
npm ci
npm run dev
```

Open http://127.0.0.1:4173, unlock, and click **Save** to prepare the repaired
encrypted edition. Edit cards locally and use the page-level Save once for the
whole draft, including unfinished fields in the current card. Save updates the private source, encrypted payload, public catalog,
backend allowlist, and backend revision together.

Unlocking keeps readable family data in memory. Refresh and Lock close that
session. A failed save keeps the draft. A stale tab cannot overwrite a newer
save; download the private draft before reloading if you need to keep its edits.

## Files and boundaries

| Location | Purpose |
| --- | --- |
| `private/family.json` | Canonical plaintext, ignored by Git and never served |
| `private/backups/` | Local migration copies and encrypted backups |
| `private/transactions/` | Verified recovery files and operation receipts; contains private plaintext |
| `data/family.enc.json` | Encrypted tree, safe to publish with a strong password |
| `data/family.anchors.public.json` | Deliberately public identifiers and reviewed labels |
| `api/generated/` | Matching backend allowlist and graph revision |
| `config/production.json` | Public production endpoint/sign-in metadata |
| `config/local.json` | Optional ignored local configuration; features disabled by default |
| `dist/` | Exact public file manifest, assembled by the build |
| `data/family.template.json` | Fictional starter data |

Use Node.js 22 or newer. The static edition has no third-party npm runtime
dependencies. Browser assets are vendored.

## Maintenance

```powershell
npm run prepare -- --dry-run
npm run verify
npm run recover -- --inspect
npm run build:production
```

A dry run does not decrypt or change live family artifacts. `verify` runs one
combined syntax, fixture/API, validation, and public-build batch. On Windows, the
password wrapper prompts without putting the password in command history:

```powershell
.\scripts\family-maintenance.ps1 prepare
.\scripts\family-maintenance.ps1 backup
.\scripts\family-maintenance.ps1 release:prepare
```

Other shells can supply `FAMILY_TREE_PASSWORD` locally for one command. Never put
it in Git, GitHub Actions, a URL, or a command argument. `encrypt` and
`generate:anchors` are compatibility aliases for the complete preparation
workflow; they no longer independently replace public files.

New public labels require explicit review. Use
`npm run prepare -- --review-publication --dry-run` to write a private preview.
After inspecting it, use the password wrapper with `prepare --approve-publication`.
Do not run `enable:all-anchors` for ordinary edits: it deliberately proposes
publishing every person's display name and birthday.

## Publish

1. Save/prepare the tree locally.
2. Run `.\scripts\family-maintenance.ps1 release:prepare`. It decrypts the
   production artifact, compares it to the canonical source, and writes
   `config/publication.json` containing only the public build digest.
3. Review the changed encrypted/catalog/backend/config files and commit them,
   including the publication receipt.
4. In GitHub repository Settings → Pages, select **GitHub Actions**.
5. Run **Publish personal edition** from Actions on `main`.

The workflow uploads only `dist/` and rejects output that differs from the locally
verified release. The password and private source stay on your computer. The
receipt records a trusted maintainer's local check; it is not an independent
cryptographic proof of decryption.

The existing production endpoints were preserved in `config/production.json`.
Local suggestions/review stay disabled unless explicitly configured. No live
cloud deployment or billing change is part of this repair.

## More detail

- [Maintainer instructions](MAINTAINER.md): setup, password rotation, restore, and publishing.
- [Privacy model](docs/privacy-model.md): public labels and the shared-password boundary.
- [Administrator review](docs/admin-review.md): review and apply additions locally.
- [Current repair progress](docs/personal-edition-repair-progress.md).
- [Stabilization plan](docs/personal-edition-stabilization-plan.md) and
  [six-stage agent playbook](docs/personal-edition-agent-plan/README.md).
