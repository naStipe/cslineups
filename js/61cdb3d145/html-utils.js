// Shared HTML-escaping helper. Anything interpolated into an innerHTML
// template string — text content or attribute values — must go through this
// first, or a value containing `"` / `<` / `>` can break out of its
// surrounding markup and inject arbitrary HTML/JS (stored XSS).
export function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
