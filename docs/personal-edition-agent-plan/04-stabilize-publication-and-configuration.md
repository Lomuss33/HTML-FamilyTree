# Step 4 — Stabilize publication and configuration

Task range: `PUB-01` through `PUB-07`. Verification cases: `P01` through `P12`.

Read the [start-here guide](README.md) and the step-2/step-3 handoffs. Complete the initial manifest builder without creating a second packaging path.

## 1. Outcome

There is a reproducible, restricted website artifact with explicit environment configuration. Local builds are safe by default, CI does not need the private tree, and website/API metadata releases are coordinated.

Site assembly does not mutate the canonical source or require the family password. Secret-dependent canonical preparation is a separate operation.

## 2. Inputs

- The public manifest/build module created in step 2.
- The committed canonical/generated bundle and transaction outcome from step 3.
- `scripts/validate-public-build.mjs` and its current working-directory scanner.
- `assets/site-config.js` and browser config consumers.
- `api/generated/public-anchor-allowlist.json` and `canonical-revision.json`.
- `template.yaml`, especially `CodeUri: api/` and metadata loading in the handlers.
- `.github/workflows/verify.yml`, `package.json`, and repository Pages settings.
- Existing privacy/catalog/config tests.

Do not read a public endpoint's existence as proof of the deployed API version. A configured URL and a matching local JSON file are different evidence.

## 3. Task PUB-01 — Finalize the site manifest

The manifest is the source of truth for publication and static serving. It must cover the import graph actually needed by the site.

Include:

- `index.html`;
- required first-party modules and styles;
- explicitly selected Family Chart/D3 assets and favicon;
- encrypted family payload;
- reviewed public catalog;
- generated public runtime configuration;
- hosting support files actually used by the deployment.

Exclude:

- `private/`, legacy plaintext, and recovery/transaction files;
- API sources, API generated backend files, dependency trees, scripts, tests, and fixtures;
- `.git`, `.aws-sam`, local env/config files, editor files, and arbitrary backups;
- unreviewed source maps or maps that embed sensitive/local sources.

Use exact files or tightly validated declared module sets. Do not replace the manifest with "copy everything except a growing denylist".

A new file required by an import must cause an understandable missing-artifact error until deliberately added. A forbidden extra file must fail validation even if it is unreferenced by the HTML.

## 4. Task PUB-02 — Assemble an immutable release directory

Suggested builder inputs:

```text
buildSite({
  projectPaths,
  publicManifest,
  preparedArtifacts,
  environment,
  basePath,
  outputDirectory
}) -> BuildReport
```

The builder:

1. Checks that no interrupted canonical transaction is unresolved.
2. Reads a verified committed artifact snapshot.
3. Resolves every declared source path and rejects escaping/symlink inputs.
4. Creates a new staging output directory inside the verified build workspace.
5. Copies only declared content and generates public config.
6. Validates the assembled output, relative URLs, and metadata.
7. Produces a safe inventory with file paths, sizes, hashes, config mode, and revisions.
8. Activates/publishes only a complete validated output.

Output cleanup must validate the resolved absolute target before recursively deleting it. Never compose cross-shell deletion commands. Building from a different current working directory should still resolve the intended project.

Keep staged output separate from the currently served release. Do not clean and refill the active directory while it is serving readers.

Deterministic properties:

- The same input artifacts/config yield the same public files and catalog/revision values.
- Encryption randomness belongs to preparation, not site assembly.
- Nonessential timestamps must not cause every site file to change.
- The report contains no private canonical values or credentials.

## 5. Task PUB-03 — Separate three validation modes

### A. Public artifact validation

Runs on the actual assembled site, including in CI without private data.

Checks:

- file manifest and absence of extras;
- HTML/module/stylesheet/asset references;
- compatible encrypted-envelope structure;
- exact catalog field allowlists and deterministic catalog version;
- site config schema and forbidden secret-bearing properties;
- expected base-path behavior;
- no symlinks/hidden private files or accidental backend package content.

### B. Local private-source freshness validation

Runs locally when the actual canonical source is available.

Checks:

- strict canonical invariants;
- catalog/allowlist/revision regenerated in memory agree with the current prepared bundle;
- encrypted payload decrypts to the canonical snapshot when the password is supplied locally;
- reviewed public labels match explicit source metadata;
- known private-value leak canaries/tokens in public output, with approved publication handled explicitly.

Schema/manifest isolation is the primary boundary; token scanning is a secondary check with possible common-name false positives. Do not silently disable it or print sensitive token values into shared logs. Provide a local, reviewable resolution path.

### C. Git tracking validation

Checks tracked paths separately from disk publication output.

- Reject tracked `private/**`, legacy plaintext, and plaintext recovery material.
- A `.gitignore` rule does not remove a file already in the index.
- Read filenames safely, including spaces/unicode; do not parse Git output by whitespace.
- Do not scan every ignored working file as though it will be deployed.

This separation fixes the backup false positive without exempting a private backup accidentally copied into `dist/`.

## 6. Task PUB-04 — Define configuration modes

Suggested sources:

| Mode | Source | External services |
| --- | --- | --- |
| Local default | Safe example + ignored local override | Disabled |
| Automated test | Explicit fictional generated config | Local fake endpoints only |
| Personal production | Reviewed public deployment variables | Intended deployed suggestion/review services |

Runtime config includes only public endpoint/domain/client/return-URL metadata. The browser never receives AWS credentials, submission codes, family passwords, or a client secret.

Validation requirements:

- Reject unknown secret-bearing config properties.
- Require HTTPS for production external services.
- Permit HTTP loopback only in an explicit test/development mode.
- Match callback/logout origin and base path to the intended deployment.
- Validate complete feature config before enabling the corresponding UI.
- Default copies/forks must not inherit active production endpoints silently.

Keep environment selection explicit. Do not infer that every non-local hostname is the intended production deployment.

An ignored local file may contain deployment metadata but still must not become a general secret bucket copied into the site. Use a narrow schema and generated output.

## 7. Task PUB-05 — Make optional services fail independently

The viewer, local editing, guest suggestion service, and administrator auth are separate capabilities.

Required behavior:

- Missing suggestion config hides or explains the unavailable feature rather than sending a failed request to an unrelated URL.
- An empty public catalog leaves the text-suggestion path understandable and the visual path clearly unavailable.
- Slow/failed administrator redirect completion does not delay wiring the unlock form.
- A failed optional count refresh cannot break chart rendering.
- Requests have bounded timeouts and abort behavior; stale callbacks do not mutate a newly locked view.
- Local API discovery is restricted to the known local runtime and protocol from step 2.

Stage 5 implements the detailed UI state transitions. This stage establishes validated configuration/capability models that the UI consumes.

## 8. Task PUB-06 — Publish the correct artifact through Pages

Prepare a Pages workflow that:

1. Checks out the selected code version.
2. Installs the declared tools/dependencies from lockfiles.
3. Runs the required verification/build checks without real private data.
4. Builds and validates `dist/` from prepared tracked publication inputs.
5. Uploads only that directory using the appropriate current Pages artifact mechanism.
6. Deploys only from the intended release branch/environment.

During implementation, verify current official GitHub action documentation/versions before pinning or updating workflow dependencies. A planning example is not a vetted future action version.

Use least required workflow permissions, a deployment environment, and concurrency controls. Pull requests validate fictional builds without obtaining production family secrets or arbitrary production deployment access.

Check repository Pages settings during an authorized release so branch-root publication cannot bypass the workflow. Editing a workflow file alone does not prove hosting settings changed.

Test with the actual repository base path and root deployment. Do not assume the current repository folder name is the public path; existing configuration may use a different published path.

## 9. Task PUB-07 — Coordinate website and API metadata

The Lambdas load generated files packaged under `api/`. Updating Pages or a root JSON file does not update a deployed Lambda package.

For each prepared release, record:

```text
code revision
site artifact digest
catalogVersion
sourceRevision
API generated-artifact digest/package reference
environment and intended base path
local preparation operation ID
verification result
deployment status of each component
```

Release rules:

- Generate all metadata from one prepared candidate.
- Validate frontend catalog, backend allowlist, and backend revision together.
- Package the exact intended generated files in the API build.
- Preserve server rejection of stale catalogs/source revisions.
- During a deployment window, show recoverable stale-version messages and retain drafts.
- After a graph topology change, old graph suggestions may legitimately require resubmission. Do not silently rebase accepted patches.
- Roll back matching site/API metadata artifacts deliberately; do not overwrite newer local canonical data or rewrite suggestion review history.

Live AWS work requires the active repository's selected-Region, plan, and spend checks. Default implementation uses local SAM/package validation and fake services. Do not create a new AWS environment merely to complete this stage.

## 10. Proposed command contracts

| Command | Required behavior |
| --- | --- |
| `npm run prepare:family` | Secret-dependent coherent canonical/generated preparation |
| `npm run validate:family` | Canonical graph check |
| `npm run validate` | Public artifact and available local freshness/tracking checks; explicit modes in output |
| `npm run build` | Build validated public output only; no canonical rewrite/password requirement |
| `npm run check:publish` | Local gates + redacted release report; no implicit push/deploy |

If a fresh CI checkout lacks the canonical source, it must explicitly say which freshness/decryption checks were not run. Passing structural checks must not be reported as full private-source readiness.

## 11. Files expected to change

- Manifest/build/validation modules and thin CLI scripts.
- `package.json` command definitions and any necessary lockfile.
- Safe example/local config handling and production config generation.
- Narrow feature initialization/config consumers.
- Pages verification/deployment workflows.
- Public artifact/config/tracking tests.
- README, maintainer, privacy, and API release instructions.

Do not change actual production endpoints, Pages settings, or AWS resources without the required task authorization and concrete release evidence.

## 12. Exit and handoff

- A build is reproducible and contains only declared public inputs.
- Local/test mode sends no unintended external requests.
- Private backups do not poison validation, but copied private output fails it.
- The site works under the actual base path.
- The API package contains matching generated metadata.
- A local release report distinguishes checked, skipped, and live-deployed work.
- Stage 5 receives stable configuration/capability contracts; stage 6 receives a verifiable site/API artifact pair.

## 13. Agent assignment prompt

> Implement step 4 of the personal-edition agent playbook. Complete the allowlisted build, split public/local-freshness/Git-tracking validation, generate explicit safe environment config, and isolate optional services. Prepare the Pages workflow to deploy only validated dist output. Verify repository-base-path behavior and matching API package metadata using fictional fixtures and local packaging. Record real hosting/AWS actions separately and do not bypass stale-version validation.
