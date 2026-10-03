/**
 * Regex matching the `.angular/cache/.../vite/deps/...?v=` URLs that
 * indicate a stale Vite dev-server dependency cache. When pdfmake tries
 * to fetch these, the dev server returns a 404 and the resulting error
 * message carries this path fragment.
 */
export const STALE_VITE_DEPS_RE = /\.angular\/cache\/[^?\s]*\/vite\/deps\/[^?\s]*\?v=/;

/**
 * Returns true when an unknown error object looks like a stale
 * `.angular/cache/.../vite/deps/...` dev-server cache miss.
 */
export function isStaleViteDepsError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const message = (err as { message?: unknown }).message;
  return typeof message === 'string' && STALE_VITE_DEPS_RE.test(message);
}
