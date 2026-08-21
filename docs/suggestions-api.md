# Guest Suggestions API

This repository's encrypted family tree stays a static GitHub Pages site. This
AWS SAM stack provides a write-only guest suggestion channel and a separate,
JWT-authenticated administrator review channel. It never receives the tree
encryption password or the decrypted tree itself.

## What is deployed

- API Gateway HTTP API: public `POST /suggestions` plus authenticated `/admin/*` routes
- Submission Lambda: validates text and additive graph suggestions and stores a normalized record
- Admin Lambda: lists, reads, and status-updates suggestions after JWT authorization
- DynamoDB: on-demand table of pending suggestions
- AWS X-Ray tracing for the Lambda function
- API Gateway throttling: two requests/second with a burst of five
- API Gateway and Lambda logs retained for 14 days, without request bodies
- DynamoDB TTL: suggestions become eligible for removal after the selected
  retention period

The public endpoint remains deliberately write-only. The admin endpoints are
isolated behind a Cognito user pool and API Gateway JWT authorizer. See
`admin-review.md` for that workflow.

## Before deployment

1. Choose the exact GitHub Pages origin, without a trailing slash. For example:

   ```text
   https://example.github.io
   ```

2. Create a separate submission access code of at least 12 characters. It must
   not be the family-tree decryption password.

3. Install the [AWS SAM CLI](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html), authenticate the AWS CLI, and choose a Region.

## Deploy

Run this from the repository root:

```bash
sam build
sam deploy --guided
```

Use these parameter values during guided deployment:

- `AllowedOrigin`: the exact Pages origin from step 1
- `SubmissionAccessCode`: the separate access code from step 2
- `SuggestionRetentionDays`: normally `365`

Record the `SuggestionsApiUrl` CloudFormation output.

## Connect the website

Replace the empty value in `assets/site-config.js` with the full output URL:

```js
window.FAMILY_TREE_CONFIG = Object.freeze({
  suggestionsApiUrl: "https://example.execute-api.eu-north-1.amazonaws.com/suggestions",
  adminApiUrl: "https://example.execute-api.eu-north-1.amazonaws.com/admin/suggestions",
  adminAuth: Object.freeze({
    clientId: "public-cognito-app-client-id",
    domain: "https://example.auth.eu-north-1.amazoncognito.com",
    redirectUri: "https://example.github.io/HTML-FamilyTree/",
    logoutUri: "https://example.github.io/HTML-FamilyTree/"
  })
});
```

Commit and publish that file with the GitHub Pages site. The API URL is public;
the submission access code is never put in a repository file.

When `suggestionsApiUrl` is a valid HTTPS URL, the same suggestion form is
available from both the locked screen and the unlocked tree toolbar. The locked
screen route never unlocks or renders the family tree; it only opens the
write-only suggestion form.

## Request contracts

Legacy text requests remain accepted. The frontend now sends the equivalent
schema-v1 text request:

```json
{
  "schemaVersion": 1,
  "type": "text",
  "accessCode": "shared-submission-code",
  "submitterName": "Ada Lovelace",
  "email": "ada@example.com",
  "relationship": "Great-grandchild",
  "message": "Please add the 1910 census record."
}
```

`email` and `relationship` are optional. The access code is checked by Lambda,
is not stored in DynamoDB, and is never returned in an API response.

Visual requests contain one allowlisted anchor and only proposed additions:

```json
{
  "schemaVersion": 1,
  "type": "graph",
  "anchorPersonId": "approved-anchor-id",
  "anchorCatalogVersion": "sha256:...",
  "sourceRevision": "sha256:...",
  "people": [
    {
      "id": "tmp_1",
      "firstName": "Fictional",
      "lastName": "Person",
      "birthday": "1970",
      "gender": "M"
    }
  ],
  "relationships": [
    { "from": "approved-anchor-id", "to": "tmp_1", "type": "parentOf" }
  ],
  "comment": "Optional context",
  "submitterName": "Guest",
  "email": "",
  "relationship": "Relative",
  "accessCode": "shared-submission-code"
}
```

The request is limited to 64 KiB, 50 proposed people, and 100 relationships.
Only `parentOf` and `spouseOf` are supported. Unknown keys and any mutation-like
operation are rejected. `api/generated/public-anchor-allowlist.json` is bundled
with Lambda and is authoritative for both the anchor id and catalog version.

## Stored records

Both request types are stored without the access code in a common envelope:

```json
{
  "id": "server-generated-id",
  "schemaVersion": 1,
  "type": "graph",
  "status": "pending",
  "createdAt": "server timestamp",
  "updatedAt": "server timestamp",
  "expiresAt": 0,
  "submitter": {
    "name": "Guest",
    "email": "",
    "relationship": "Relative"
  },
  "payload": {
    "anchorPersonId": "approved-anchor-id",
    "anchorCatalogVersion": "sha256:...",
    "sourceRevision": "sha256:...",
    "people": [],
    "relationships": [],
    "comment": ""
  }
}
```

Existing legacy DynamoDB records remain valid because DynamoDB does not require
non-key attributes to share a schema. No table migration or replacement is
needed. Operational logs contain request id, suggestion type, result category,
and validation category only; request bodies and personal data are not logged.

## Operations

- Monitor cost with an AWS Budget; alerts are delayed and are not a hard cap.
- DynamoDB TTL deletion is asynchronous, so expired suggestions may remain for
  some time after `expiresAt`.
- Rotate the submission access code with a CloudFormation parameter update.
- Regenerate and commit both anchor artifacts before building Lambda whenever
  public anchor membership or labels change.
- Never remove the JWT authorizer from the admin GET/PATCH routes.
- Delete the CloudFormation stack to remove the AWS resources when the feature
  is no longer needed. Back up/export any suggestions first.
