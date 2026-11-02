// Headers every response carries. The page loads only its own files; styles allow inline because React sets style attributes.
export let tls = false;
export const setTls = (on: boolean) => { tls = on; };

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; " +
  "connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

export function secure(h: Record<string, string | number>): Record<string, string | number> {
  return {
    ...h,
    "Content-Security-Policy": CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...(tls ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}
