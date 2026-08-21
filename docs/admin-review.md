# Authenticated Administrator Review

## Security boundary

Administrator review uses a dedicated Amazon Cognito user pool. It does not
reuse the family-tree password or guest submission access code. The browser is
a public OAuth client with no client secret and uses authorization code with
PKCE, `state`, and `nonce`.

The Cognito user pool is administrator-create-only and requires TOTP MFA. The
static frontend stores the short-lived 15-minute access and ID tokens only in
`sessionStorage`; it deliberately discards refresh tokens. Locking the family
tree clears the local admin session. Explicit sign-out also ends the Cognito
hosted-UI session.

API Gateway validates JWT signature, issuer, audience/client id, expiry, and
the `openid` scope before invoking the admin Lambda. The Lambda additionally
requires `token_use=access`, the configured client id, and a subject claim.

## Routes and permissions

- `POST /suggestions` remains public apart from its existing submission-code check.
- `GET /admin/suggestions` queries the status/created-time index with bounded pagination.
- `GET /admin/suggestions/{id}` retrieves one explicit suggestion id.
- `PATCH /admin/suggestions/{id}` sets `pending`, `accepted`, or `rejected` and an optional note.

The public Lambda can only call DynamoDB `PutItem`. The admin Lambda can only
call `GetItem`, `Query` on `status-createdAt-index`, and `UpdateItem`. Neither
Lambda can scan or delete the table, and neither can access the canonical tree.
Responses are projected through explicit field allowlists so legacy secrets or
unexpected DynamoDB attributes are never returned.

## Review UI

The Review button appears only after the encrypted family tree has been
unlocked. Cognito authentication is still required inside the panel. The side
rail supports status/type filters, bounded pagination, submitter/date/status
summaries, and explicit detail retrieval.

Graph records have three non-mutating visual modes:

- Original: the canonical anchor and its one-hop relationships.
- Suggestion: the anchor plus proposed temporary people.
- Overlay: canonical one-hop context plus proposed additions.

Original, Anchor, and Proposed cards use text badges and distinct border
treatments, not color alone. Rendering is performed from cloned adapters;
Family Chart remains a layout engine and never becomes review state.

## Stale revisions and acceptance

The admin Lambda package includes `api/generated/canonical-revision.json`.
Accepting a graph is rejected with HTTP 409 unless both the stored
`anchorCatalogVersion` and `sourceRevision` equal that deployed artifact.
Text acceptance does not require a graph revision.

The browser independently compares the suggestion with the current public
catalog metadata and produces a deterministic patch with this shape:

```json
{
  "schemaVersion": 1,
  "type": "family-additions",
  "suggestionId": "server-generated-id",
  "anchorPersonId": "canonical-anchor",
  "anchorCatalogVersion": "sha256:...",
  "sourceRevision": "sha256:...",
  "addPeople": [],
  "addRelationships": []
}
```

Temporary ids are deterministically mapped to `sg_<suggestion>_<number>` ids.
The schema has no delete, update, replace, detach, or arbitrary patch fields.

## Local patch application

Always inspect the downloaded JSON first. A dry run performs validation only:

```bash
npm run apply:additions -- --patch /path/to/patch.json --dry-run
```

To apply and regenerate all artifacts:

```bash
FAMILY_TREE_PASSWORD='local-password' \
  npm run apply:additions -- --patch /path/to/patch.json
```

The script:

1. validates the current private family;
2. checks catalog and source revisions;
3. rejects temporary, duplicate, disconnected, mutation-like, and
   canonical-to-canonical operations;
4. creates reciprocal parent/child or spouse arrays in memory;
5. validates cycles, parent counts, ids, and all canonical invariants;
6. generates candidate encrypted/catalog/allowlist/revision artifacts in a
   temporary directory;
7. backs up `data/family.private.json` under ignored `data/backups/`;
8. replaces the prepared outputs and runs public-build validation.

The script does not commit, push, upload, or call AWS.

## Creating the first administrator

After deployment, create a Cognito user with the AWS CLI:

```bash
aws cognito-idp admin-create-user \
  --user-pool-id YOUR_USER_POOL_ID \
  --username YOUR_EMAIL \
  --user-attributes Name=email,Value=YOUR_EMAIL Name=email_verified,Value=true \
  --desired-delivery-mediums EMAIL \
  --region eu-north-1 \
  --profile familytree-prod
```

The invitation contains a temporary password. On first hosted-UI sign-in,
Cognito requires a new strong password and TOTP setup. No administrator user or
password is stored in CloudFormation or repository files.
