# Guest Suggestions API

This repository's encrypted family tree stays a static GitHub Pages site. This
optional AWS SAM stack adds a separate, write-only guest suggestion channel.
It never receives the tree encryption password or the decrypted tree itself.

## What is deployed

- API Gateway HTTP API: `POST /suggestions`, HTTPS by default
- Lambda: validates and stores a suggestion
- DynamoDB: on-demand table of pending suggestions
- AWS X-Ray tracing for the Lambda function
- API Gateway throttling: two requests/second with a burst of five
- Lambda reserved concurrency: two concurrent requests
- API Gateway and Lambda logs retained for 14 days, without request bodies
- DynamoDB TTL: suggestions become eligible for removal after the selected
  retention period

The endpoint is deliberately write-only. Review suggestions in the DynamoDB
console or add an authenticated admin workflow later.

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
  suggestionsApiUrl: "https://example.execute-api.eu-central-1.amazonaws.com/suggestions"
});
```

Commit and publish that file with the GitHub Pages site. The API URL is public;
the submission access code is never put in a repository file.

The Suggest an update button appears only after the family tree is unlocked and
only when `suggestionsApiUrl` is a valid HTTPS URL.

## Request contract

```json
{
  "accessCode": "shared-submission-code",
  "submitterName": "Ada Lovelace",
  "email": "ada@example.com",
  "relationship": "Great-grandchild",
  "message": "Please add the 1910 census record."
}
```

`email` and `relationship` are optional. The access code is checked by Lambda,
is not stored in DynamoDB, and is never returned in an API response.

## Operations

- Monitor cost with an AWS Budget; alerts are delayed and are not a hard cap.
- DynamoDB TTL deletion is asynchronous, so expired suggestions may remain for
  some time after `expiresAt`.
- Rotate the submission access code with a CloudFormation parameter update.
- Do not add an unauthenticated GET endpoint for suggestion data.
- Delete the CloudFormation stack to remove the AWS resources when the feature
  is no longer needed. Back up/export any suggestions first.
