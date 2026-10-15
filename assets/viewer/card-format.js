export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

export function safeAvatarUrl(value) {
  if (typeof value !== "string" || !value.trim()) return "";
  try {
    const url = new URL(value, globalThis.location?.href ?? "https://example.invalid/");
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return "";
    return url.href;
  } catch { return ""; }
}

export function createCanonicalCardHtml(datum) {
  const person = datum?.data?.data ? datum.data : datum;
  const data = person?.data ?? {};
  const name = [data["first name"], data["last name"]].filter(Boolean).join(" ") || "Unnamed person";
  const avatar = safeAvatarUrl(data.avatar);
  return '<div class="card-inner card-rect personal-tree-card">'
    + (avatar ? '<img class="personal-tree-avatar" referrerpolicy="no-referrer" alt="" src="' + escapeHtml(avatar) + '">' : "")
    + '<strong>' + escapeHtml(name) + '</strong>'
    + (data.birthday ? '<span>' + escapeHtml(data.birthday) + '</span>' : "")
    + '</div>';
}
