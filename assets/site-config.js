/*
 * Public runtime configuration.
 *
 * After deploying template.yaml, replace suggestionsApiUrl with the
 * SuggestionsApiUrl CloudFormation output and commit this file. The API URL is
 * public information; never put the submission access code or family password
 * here.
 */
window.FAMILY_TREE_CONFIG = Object.freeze({
  suggestionsApiUrl: "https://zzxey0gbd8.execute-api.eu-central-1.amazonaws.com/suggestions"
});
