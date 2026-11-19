export class LocalApiError extends Error {
  constructor(code, message, status = 0) {
    super(message); this.name = "LocalApiError"; this.code = code; this.status = status;
  }
}

// Network editing is opt-in at the server and requires HTTPS. Discovery still
// has to supply a valid capability before any password or draft is sent.
export function supportsLocalEditing({ protocol, hostname } = {}, { access } = {}) {
  if (access === "public") return false;
  if (!["http:", "https:"].includes(protocol)) return false;
  if (["localhost", "127.0.0.1"].includes(hostname)) return true;
  // The private homelab listener marks its HTML explicitly. This permits its
  // HTTPS DNS name; actual authorization remains at the listener and password.
  if (access === "private" && protocol === "https:") return true;
  if (protocol !== "https:" || typeof hostname !== "string" || !/^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname)) return false;
  const [first, second, ...rest] = hostname.split(".").map(Number);
  if ([first, second, ...rest].some(value => value > 255)) return false;
  return first === 10 || (first === 172 && second >= 16 && second <= 31)
    || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127);
}

export async function hashPayloadText(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return "sha256:" + [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

export function createLocalApiClient({ fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 15000 } = {}) {
  let capability = null;
  async function request(url, body, binary = false) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: body === undefined ? "GET" : "POST", cache: "no-store", credentials: "omit",
        signal: controller.signal, redirect: "error",
        headers: { ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(capability?.csrfToken ? { "X-Family-Local-Token": capability.csrfToken } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (binary && response.ok) {
        if (!["image/png", "image/jpeg", "image/webp"].includes(response.headers.get("content-type"))) throw new LocalApiError("INVALID_MEDIA", "Photo response is invalid.");
        return response.blob();
      }
      if (!response.headers.get("content-type")?.includes("application/json")) throw new LocalApiError("LOCAL_UNAVAILABLE", "The protected local service is unavailable.");
      const result = await response.json();
      if (!response.ok) throw new LocalApiError(result.code ?? "LOCAL_FAILED", result.message ?? "The local operation failed.", response.status);
      return result;
    } catch (error) {
      if (error instanceof LocalApiError) throw error;
      throw new LocalApiError("TRANSPORT_ERROR", "The local response was interrupted. Your draft has been kept.");
    } finally { clearTimeout(timeout); }
  }
  return {
    async discover() {
      const value = await request("/api/status");
      if (value.protocolVersion !== 2 || value.localSave !== true || typeof value.csrfToken !== "string"
        || !/^[a-zA-Z0-9_-]{32,100}$/.test(value.csrfToken)
        || !/^sha256:[a-f0-9]{64}$/.test(value.snapshotId ?? "")
        || !/^sha256:[a-f0-9]{64}$/.test(value.payloadDigest ?? "")) {
        capability = null;
        throw new LocalApiError(value.code ?? "LOCAL_UNAVAILABLE", value.message ?? "Local saving is unavailable.");
      }
      capability = value;
      return value;
    },
    async open(password, payloadDigest) {
      if (!capability) await this.discover();
      return request("/api/session", { password, payloadDigest });
    },
    save: requestBody => request("/api/save", requestBody),
    receipt: operationId => request("/api/operations/" + encodeURIComponent(operationId)),
    uploadPhoto: body => request("/api/media/upload", body),
    readPhoto: body => request("/api/media/read", body, true),
    suggestionRequest: (action, body) => request("/api/admin/suggestions/" + action, body),
    readSuggestionPhoto: body => request("/api/admin/suggestions/photo", body, true),
    clear() { capability = null; }
  };
}
