import { FamilyWorkflowError } from "./project-paths.mjs";

export function validateHomelabConfig(value) {
  const keys = ["privateOrigin", "privatePort", "publicOrigin", "publicPort"];
  if (!value || typeof value !== "object" || Array.isArray(value)
    || Object.keys(value).sort().join() !== keys.sort().join()) {
    throw new FamilyWorkflowError("INVALID_HOMELAB_CONFIG", "Supply exactly publicOrigin, privateOrigin, publicPort and privatePort.");
  }
  for (const key of ["publicOrigin", "privateOrigin"]) {
    let url;
    try { url = new URL(value[key]); } catch { /* Report no user-supplied values. */ }
    if (!url || url.protocol !== "https:" || url.origin !== value[key] || url.username || url.password) {
      throw new FamilyWorkflowError("INVALID_HOMELAB_CONFIG", "Both homelab origins must be exact HTTPS origins without paths or credentials.");
    }
  }
  if (value.publicOrigin === value.privateOrigin) {
    throw new FamilyWorkflowError("INVALID_HOMELAB_CONFIG", "Public and private access must use different HTTPS origins.");
  }
  for (const key of ["publicPort", "privatePort"]) {
    if (!Number.isInteger(value[key]) || value[key] < 1024 || value[key] > 65535) {
      throw new FamilyWorkflowError("INVALID_HOMELAB_CONFIG", "Choose two distinct unprivileged local ports from 1024 to 65535.");
    }
  }
  if (value.publicPort === value.privatePort) {
    throw new FamilyWorkflowError("INVALID_HOMELAB_CONFIG", "Public and private listeners must use different local ports.");
  }
  return { ...value };
}

// Client-side presentation only. The server independently denies private routes
// on the public listener, regardless of this marker or any forwarded headers.
export function homelabPage(bytes, access) {
  let html = bytes.toString("utf8").replace("<html ", '<html data-family-access="' + access + '" ');
  if (access === "public") html = html.replace('id="admin-entry"', 'id="admin-entry" hidden inert');
  return Buffer.from(html);
}
