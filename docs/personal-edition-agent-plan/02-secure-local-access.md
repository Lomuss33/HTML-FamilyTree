# Step 2 — Secure local access

Task range: `HTTP-01` through `HTTP-06`. Verification cases: `H01` through `H12`.

Read the [start-here guide](README.md) and the step-1 handoff. This stage closes the local HTTP exposure while establishing a small, testable boundary for the later save workflow.

## 1. Outcome

The local server serves only an approved static release and exposes a loopback-only maintenance API. Untrusted requests cannot read private files or write canonical data. A correctly configured local browser can still unlock the viewer and use the authorized save flow.

Binding to loopback remains necessary, but request validation and file allowlisting are additional independent controls.

## 2. Source areas to inspect

- `scripts/local-server.mjs`: URL construction, dispatch, `serveStatic`, `readJsonBody`, and startup.
- `assets/app.js`: `detectLocalSaveSupport`, `persistFiles`, hostname detection, and save errors.
- `index.html`: asset URLs and required scripts/styles.
- `assets/site-config.js`: optional external endpoints.
- The private/build path resolver introduced in step 1.
- Existing local-save tests, which import helpers but do not exercise every HTTP request boundary.

Do not start the baseline repository-root server against real data as a shortcut to browser testing.

## 3. Task HTTP-01 — Make server lifecycle injectable

Replace import-time server configuration with a small factory. Suggested contract:

```text
createLocalServer({
  projectPaths,
  host,
  port,
  publicRelease,
  saveService,
  limits,
  logger
}) -> server/lifecycle object
```

Requirements:

- Importing the module does not listen on a port or write files.
- CLI startup resolves the intended project and listens on loopback.
- Tests can listen on port 0 and use the actual assigned port.
- Test roots, loggers, operation handlers, and request limits are injectable.
- Shutdown closes listeners and releases handles so temporary directories can be removed on Windows.
- Exceptions are handled across awaited route handlers; promise rejections must not escape the request error boundary.

Do not make arbitrary host binding a casually configurable public option. Supporting LAN hosting is outside this personal repair.

## 4. Task HTTP-02 — Assemble and serve a minimal public manifest

Implement the essential assembly portion of step 4 now. It should be a small reusable builder, not a second build system.

The manifest explicitly lists the HTML shell, required first-party modules/styles, selected vendor files, favicon, encrypted payload, reviewed public catalog, and generated nonsecret runtime config.

Resolution rules:

1. Work from a trusted public-release root.
2. Parse and normalize the request URL once.
3. Reject malformed encodings, NUL bytes, ambiguous separators, Windows drive/UNC paths, and traversal attempts.
4. Resolve the file's real path and verify containment using path segments/`path.relative`, not a string-prefix comparison.
5. Reject symlinks/junctions or any resolved target outside the selected public release.
6. Serve only files present in the approved release manifest.
7. Do not fall back to repository-root paths or guess a missing file by extension.
8. GET/HEAD use the same authorization/path decision. HEAD returns correct headers without a body.

Return 403/404 for forbidden paths without revealing whether a private file exists. Do not expose directory listings.

The manifest must reject accidental additions such as backups, tests, source maps containing private sources, API source, maintenance scripts, private config, or `api/generated/`. A vendor file is included deliberately rather than by copying the whole repository.

For a first run, assemble from existing prepared public artifacts. Failure to assemble must produce a clear startup error, never an unsafe fallback server.

## 5. Task HTTP-03 — Define local capability discovery

Replace the current "`response.ok` means editing is available" check with a validated protocol response.

Suggested local-only response:

```json
{
  "protocolVersion": 2,
  "localSave": true,
  "csrfToken": "per-process-random-value",
  "snapshotId": "opaque-local-snapshot",
  "privateRevision": "local-only-full-state-revision",
  "payloadDigest": "digest-of-the-associated-encrypted-payload"
}
```

The precise revision/snapshot implementation is completed in step 3. Until it is present, do not fake a protected capability as working. Tests may inject a fake save service with the same boundary.

Capability rules:

- Generate an unpredictable process token with Node crypto.
- Return it only from the local API with no-store caching and validated Host/Origin rules.
- Do not place it in static files, URLs, tracked configuration, logs, or browser durable storage.
- Permit absent Origin for normal same-origin GET discovery where browsers omit it; reject foreign Origin when present. Mutation requests require the exact expected Origin.
- Validate protocol version, content type, and required response fields in the browser.
- A random website's unrelated `/api/status` response cannot enable editing.

The snapshot/revision must describe the payload the browser actually loaded. Do not attach a fresh private revision to an unrelated cached ciphertext.

## 6. Task HTTP-04 — Enforce write-request checks before parsing or crypto

For each mutation, perform checks in a fixed order:

| Order | Check | Failure behavior |
| --- | --- | --- |
| 1 | Method and known route | 404/405; no body accumulation |
| 2 | Exact permitted loopback Host and port | Reject; no file reads/writes |
| 3 | Exact same-origin Origin | 403 for missing/foreign Origin |
| 4 | Supported JSON content type | 415 for text/plain, form, multipart, or unsupported charset |
| 5 | Constant-time comparison of the expected local token | 403 for absent/invalid token |
| 6 | Fetch Metadata when supplied | Reject contradictory cross-site context |
| 7 | Declared and streamed body size | 413 before unbounded buffering |
| 8 | Well-formed JSON and request shape | 400 with safe validation code |
| 9 | Snapshot/revision, password, canonical workflow | Structured domain result from step 3 |

Use an exact set of valid local origins derived from the actual listening address/port. Do not accept arbitrary `localhost.example`, hostname suffixes, Host port mismatches, `Origin: null`, or reflected user-provided hosts.

Keep CORS closed. Unsupported preflight requests do not grant cross-origin access. Do not rely only on the browser deciding a request requires preflight.

The local maintenance token is not a replacement for family unlock. It protects the local write boundary; the workflow still validates the intended candidate, current credentials, and stale-state checks.

## 7. Task HTTP-05 — Bound input and redact output

Proposed local defaults:

- 2 MiB maximum JSON body, measured in bytes.
- Explicit header/body timeouts and bounded request processing.
- Conservative limits on outstanding maintenance operations.
- One exclusive canonical writer, implemented fully in step 3.

Keep the existing separate 64 KiB guest submission limit. These are separate endpoints and data models.

Details to cover:

- A misleading/missing Content-Length does not bypass the streamed limit.
- A multibyte UTF-8 body is measured correctly.
- An aborted client does not leave a write in an unknown state.
- An incomplete or malformed request cannot produce an uncaught rejection.
- Generic failures do not echo a password, candidate JSON, request body, filesystem credentials, or a sensitive stack trace.
- Logs use safe operation IDs, categories, status, duration, and counts where useful.

Return a consistent safe envelope, for example:

```json
{
  "ok": false,
  "code": "STALE_SNAPSHOT",
  "message": "The saved tree changed. Your draft has been kept.",
  "operationId": "opaque-operation-id",
  "retryable": false
}
```

Do not expose arbitrary internal exception text directly to the browser.

## 8. Task HTTP-06 — Exercise the actual boundary

Create a temporary fictional project containing:

- a valid public build and a synthetic encrypted payload;
- private source/recovery files with unique canaries;
- fake `.git`, API source, and backend metadata;
- a sibling directory whose name shares the public root's prefix;
- a symlink/junction case when platform privileges support creating one.

Start the real server factory and issue HTTP requests. Inject a save handler that records whether it ran. Rejected requests must leave every file unchanged and the handler uncalled.

Cover the matrix H01-H12, including Host spoofing, missing/foreign Origin, token failures, text/plain saves, malformed/oversized/aborted requests, and a valid same-origin save.

A Node HTTP test can prove server acceptance/rejection even when browser network policies add other barriers. State this correctly in the evidence.

## 9. Windows and static-host details

Windows paths use backslashes, drive letters, case-insensitive behavior, and junctions. Do not import assumptions from a POSIX-only traversal test. Validate resolved paths before any recursive cleanup.

The published GitHub Pages site has no local maintenance API. Its missing `/api/status` must leave editing unavailable without showing an alarming failure. The site may be mounted under a repository subpath; preserve relative public asset URLs.

## 10. Files and expected changes

| Area | Expected paths |
| --- | --- |
| HTTP lifecycle/security | `scripts/local-server.mjs`; small `scripts/lib/` helpers if useful |
| Manifest/assembly foundation | `scripts/lib/publication.mjs` and/or `scripts/build-site.mjs` |
| Browser handshake/save client | Narrow changes in `assets/app.js` or new `assets/editor/local-api.js` |
| Verification | New real-HTTP integration tests and fictional workspace helper |
| Documentation | Local server boundaries, limits, and startup behavior |

Do not silently complete the later browser-state refactor in this security change. Integrate only the protocol work needed to keep valid local use functioning.

## 11. Exit and handoff

- Only manifest-approved static files are readable.
- Every rejected mutation is demonstrably non-mutating.
- Local startup/import/shutdown is testable on Windows.
- The browser requires the known local protocol before enabling editing.
- No production external endpoint is contacted by the HTTP tests.
- Step 3 has a defined save-service interface, safe error envelope, and capability/snapshot contract.

If the full save implementation is not yet ready, make the server report that maintenance is unavailable instead of enabling an unprotected legacy handler.

## 12. Agent assignment prompt

> Implement step 2 of the personal-edition agent playbook. Build the minimal allowlisted public release, refactor local server lifecycle for isolated testing, restrict real-path serving, and enforce Host/Origin/JSON/token/body-limit checks. Preserve loopback-only behavior and static Pages compatibility. Prove the boundary with real HTTP tests using fictional temporary files. Hand step 3 a validated local protocol and safe save-service interface; never fall back to the repository-root server or unprotected legacy writes.
