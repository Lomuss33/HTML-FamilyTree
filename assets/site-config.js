/*
 * Public runtime configuration.
 *
 * After deploying template.yaml, replace suggestionsApiUrl with the
 * SuggestionsApiUrl CloudFormation output and commit this file. The API URL is
 * public information; never put the submission access code or family password
 * here.
 */
window.FAMILY_TREE_CONFIG = Object.freeze({
  suggestionsApiUrl: "https://ut0iw0dyyf.execute-api.eu-north-1.amazonaws.com/suggestions"
});
