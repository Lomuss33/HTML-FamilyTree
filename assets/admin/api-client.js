export function createAdminApiClient({
  apiUrl = globalThis.window?.FAMILY_TREE_CONFIG?.adminApiUrl,
  getAccessToken,
  fetchImpl = globalThis.fetch?.bind(globalThis)
} = {}) {
  const collectionUrl = validateAdminApiUrl(apiUrl);
  if (typeof getAccessToken !== "function") throw new Error("Admin access-token provider is required.");
  if (typeof fetchImpl !== "function") throw new Error("Fetch is unavailable.");

  async function request(url, options = {}) {
    const accessToken = getAccessToken();
    if (!accessToken) throw new AdminApiError(401, "Administrator sign-in is required.");
    const response = await fetchImpl(url, {
      ...options,
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers
      }
    });
    let payload = null;
    try {
      payload = await response.json();
    } catch {
      // The API intentionally exposes only generic error text.
    }
    if (!response.ok) {
      throw new AdminApiError(response.status, safeErrorMessage(response.status, payload?.error));
    }
    return payload;
  }

  return {
    list({ status = "pending", type = "", limit = 25, nextToken = "" } = {}) {
      const url = new URL(collectionUrl);
      url.searchParams.set("status", status);
      if (type) url.searchParams.set("type", type);
      url.searchParams.set("limit", String(limit));
      if (nextToken) url.searchParams.set("nextToken", nextToken);
      return request(url);
    },

    get(id) {
      return request(`${collectionUrl}/${encodeURIComponent(id)}`);
    },

    review(id, { status, reviewerNote = "" }) {
      return request(`${collectionUrl}/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: JSON.stringify({ status, reviewerNote })
      });
    }
  };
}

export class AdminApiError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "AdminApiError";
    this.status = status;
  }
}

function validateAdminApiUrl(value) {
  if (typeof value !== "string" || !value) throw new Error("Administrator API URL is not configured.");
  const url = new URL(value);
  if (url.protocol !== "https:") throw new Error("Administrator API URL must use HTTPS.");
  if (!url.pathname.endsWith("/admin/suggestions")) throw new Error("Administrator API URL is invalid.");
  return url.toString().replace(/\/$/, "");
}

function safeErrorMessage(status, message) {
  if (status === 401 || status === 403) return "Administrator session expired or is not authorized.";
  if (status === 404) return "Suggestion not found.";
  if (status === 409) return typeof message === "string" ? message : "Suggestion changed; reload and try again.";
  if (status >= 400 && status < 500) return "The review request was not accepted.";
  return "The administrator service is temporarily unavailable.";
}
