export class LocalApiError extends Error {
  constructor(code, message, status = 0) {
    super(message); this.name = "LocalApiError"; this.code = code; this.status = status;
  }
}

export async function hashPayloadText(text) {
  const bytes = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)));
  return "sha256:" + [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");
}

export function createLocalApiClient({ fetchImpl = globalThis.fetch?.bind(globalThis), timeoutMs = 15000 } = {}) {
  let capability = null;
  async function request(url, body) {
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
    clear() { capability = null; }
  };
}
