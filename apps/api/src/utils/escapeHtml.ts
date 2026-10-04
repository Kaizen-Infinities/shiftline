/**
 * HTML escaping for server-rendered documents (PDF templates, emails). Every value that comes
 * from a tenant or user must go through `escapeHtml` (text and quoted attributes) or `safeUrl`
 * (src/href) before it is interpolated into markup.
 */
const ENTITIES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** Escapes & < > " ' ; null/undefined become "", numbers and other values are stringified. */
export const escapeHtml = (v: unknown): string =>
  v === null || v === undefined ? "" : String(v).replace(/[&<>"']/g, (c) => ENTITIES[c]);

/**
 * Returns an escaped URL safe for a src/href attribute, or "" when the scheme is not allowed.
 * Allowed: https:, and data:image/(png|jpeg|gif|webp) base64 (not svg). `allowLocalHttp` also
 * lets http://localhost through for development portal links.
 */
export const safeUrl = (v: unknown, opts: { allowLocalHttp?: boolean } = {}): string => {
  if (typeof v !== "string") return "";
  const url = v.trim();
  if (!url) return "";
  const ok =
    /^https:\/\/\S+$/i.test(url) ||
    /^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(url) ||
    (opts.allowLocalHttp === true &&
      /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/\S*)?$/i.test(url));
  return ok ? escapeHtml(url) : "";
};
