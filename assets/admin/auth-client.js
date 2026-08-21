const AUTH_SESSION_KEY = "family-tree-admin-session-v1";
const AUTH_FLOW_KEY = "family-tree-admin-oauth-flow-v1";

export function createAdminAuthClient({
  config = globalThis.window?.FAMILY_TREE_CONFIG?.adminAuth,
  sessionStore = globalThis.sessionStorage,
  fetchImpl = globalThis.fetch?.bind(globalThis),
  cryptoApi = globalThis.crypto,
  locationObject = globalThis.location,
  historyObject = globalThis.history,
  now = () => Date.now()
} = {}) {
  validateConfig(config);
  if (!sessionStore || typeof sessionStore.getItem !== "function") throw new Error("Session storage is unavailable.");
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable.");
  if (!cryptoApi?.subtle || typeof cryptoApi.getRandomValues !== "function") throw new Error("Web Crypto is unavailable.");

  async function beginLogin() {
    const verifier = randomBase64Url(64, cryptoApi);
    const state = randomBase64Url(32, cryptoApi);
    const nonce = randomBase64Url(32, cryptoApi);
    const challenge = base64Url(new Uint8Array(await cryptoApi.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(verifier)
    )));
    sessionStore.setItem(AUTH_FLOW_KEY, JSON.stringify({ state, nonce, verifier }));

    const url = new URL("/oauth2/authorize", normalizedDomain(config.domain));
    url.search = new URLSearchParams({
      response_type: "code",
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: "openid email",
      state,
      nonce,
      code_challenge_method: "S256",
      code_challenge: challenge
    }).toString();
    locationObject.assign(url.toString());
  }

  async function completeRedirect() {
    const url = new URL(locationObject.href);
    const error = url.searchParams.get("error");
    const code = url.searchParams.get("code");
    if (!error && !code) return { handled: false, authenticated: Boolean(getSession()) };

    try {
      if (error) throw new Error("Administrator sign-in was not completed.");
      const flow = parseStoredJson(sessionStore.getItem(AUTH_FLOW_KEY));
      const returnedState = url.searchParams.get("state");
      if (!flow || !constantTimeEqual(flow.state, returnedState)) throw new Error("Administrator sign-in state is invalid or expired.");

      const response = await fetchImpl(new URL("/oauth2/token", normalizedDomain(config.domain)), {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          client_id: config.clientId,
          code,
          redirect_uri: config.redirectUri,
          code_verifier: flow.verifier
        }).toString()
      });
      if (!response.ok) throw new Error("Administrator sign-in could not be completed.");
      const result = await response.json();
      const accessClaims = parseJwtClaims(result.access_token);
      const identityClaims = parseJwtClaims(result.id_token);
      validateReturnedClaims(accessClaims, identityClaims, flow.nonce, config.clientId, now());

      const session = {
        accessToken: result.access_token,
        idToken: result.id_token,
        expiresAt: accessClaims.exp * 1000,
        subject: accessClaims.sub,
        email: typeof identityClaims.email === "string" ? identityClaims.email : ""
      };
      sessionStore.setItem(AUTH_SESSION_KEY, JSON.stringify(session));
      return { handled: true, authenticated: true, session: publicSession(session) };
    } finally {
      sessionStore.removeItem(AUTH_FLOW_KEY);
      stripOAuthParameters(locationObject, historyObject);
    }
  }

  function getSession() {
    const session = parseStoredJson(sessionStore.getItem(AUTH_SESSION_KEY));
    if (!isSessionValid(session, now())) {
      sessionStore.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return publicSession(session);
  }

  function getAccessToken() {
    const session = parseStoredJson(sessionStore.getItem(AUTH_SESSION_KEY));
    if (!isSessionValid(session, now())) {
      sessionStore.removeItem(AUTH_SESSION_KEY);
      return null;
    }
    return session.accessToken;
  }

  function clearLocalSession() {
    sessionStore.removeItem(AUTH_SESSION_KEY);
    sessionStore.removeItem(AUTH_FLOW_KEY);
  }

  function beginLogout() {
    clearLocalSession();
    const url = new URL("/logout", normalizedDomain(config.domain));
    url.search = new URLSearchParams({
      client_id: config.clientId,
      logout_uri: config.logoutUri
    }).toString();
    locationObject.assign(url.toString());
  }

  return {
    beginLogin,
    beginLogout,
    clearLocalSession,
    completeRedirect,
    getAccessToken,
    getSession
  };
}

export function parseJwtClaims(value) {
  if (typeof value !== "string") throw new Error("Authentication response is invalid.");
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Authentication response is invalid.");
  try {
    const normalized = parts[1].replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const binary = atob(padded);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    const claims = JSON.parse(new TextDecoder().decode(bytes));
    if (!claims || typeof claims !== "object" || Array.isArray(claims)) throw new Error();
    return claims;
  } catch {
    throw new Error("Authentication response is invalid.");
  }
}

function validateReturnedClaims(accessClaims, identityClaims, nonce, clientId, currentTime) {
  const nowSeconds = Math.floor(currentTime / 1000);
  if (accessClaims.token_use !== "access"
    || accessClaims.client_id !== clientId
    || typeof accessClaims.sub !== "string"
    || !accessClaims.sub
    || !Number.isFinite(accessClaims.exp)
    || accessClaims.exp <= nowSeconds) {
    throw new Error("Administrator access token is invalid.");
  }
  if (identityClaims.token_use !== "id"
    || identityClaims.aud !== clientId
    || identityClaims.sub !== accessClaims.sub
    || !constantTimeEqual(identityClaims.nonce, nonce)
    || !Number.isFinite(identityClaims.exp)
    || identityClaims.exp <= nowSeconds) {
    throw new Error("Administrator identity token is invalid.");
  }
}

function validateConfig(config) {
  if (!config || typeof config !== "object") throw new Error("Administrator authentication is not configured.");
  for (const key of ["clientId", "domain", "redirectUri", "logoutUri"]) {
    if (typeof config[key] !== "string" || !config[key]) throw new Error(`Administrator authentication ${key} is not configured.`);
  }
  for (const key of ["redirectUri", "logoutUri"]) {
    const url = new URL(config[key]);
    if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
      throw new Error(`Administrator authentication ${key} must use HTTPS.`);
    }
  }
}

function normalizedDomain(value) {
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Administrator authentication domain must use HTTPS.");
  return `${url.origin}/`;
}

function randomBase64Url(length, cryptoApi) {
  const bytes = new Uint8Array(length);
  cryptoApi.getRandomValues(bytes);
  return base64Url(bytes);
}

function base64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

function constantTimeEqual(left, right) {
  if (typeof left !== "string" || typeof right !== "string" || left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function isSessionValid(session, currentTime) {
  return session
    && typeof session.accessToken === "string"
    && typeof session.idToken === "string"
    && typeof session.subject === "string"
    && Number.isFinite(session.expiresAt)
    && session.expiresAt > currentTime + 30_000;
}

function publicSession(session) {
  return Object.freeze({
    authenticated: true,
    expiresAt: session.expiresAt,
    subject: session.subject,
    email: session.email
  });
}

function parseStoredJson(value) {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function stripOAuthParameters(locationObject, historyObject) {
  const url = new URL(locationObject.href);
  for (const key of ["code", "state", "error", "error_description"]) url.searchParams.delete(key);
  historyObject?.replaceState?.({}, "", `${url.pathname}${url.search}${url.hash}`);
}
