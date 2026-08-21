/*
 * Public runtime configuration.
 *
 * These endpoint, domain, and OAuth client identifiers are public deployment
 * metadata. Never put passwords, submission codes, client secrets, or AWS
 * credentials here.
 */
window.FAMILY_TREE_CONFIG = Object.freeze({
  suggestionsApiUrl: "https://ut0iw0dyyf.execute-api.eu-north-1.amazonaws.com/suggestions",
  adminApiUrl: "https://ut0iw0dyyf.execute-api.eu-north-1.amazonaws.com/admin/suggestions",
  adminAuth: Object.freeze({
    clientId: "44r1qdl0mj62cimr4ecjpsupgg",
    domain: "https://familytree-admin-047600599889-v3.auth.eu-north-1.amazoncognito.com",
    redirectUri: "https://lomuss33.github.io/HTML-FamilyTree/",
    logoutUri: "https://lomuss33.github.io/HTML-FamilyTree/"
  })
});
