export let tls = false;
export const setTls = (on: boolean) => { tls = on; };

const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; " +
  "connect-src 'self'; frame-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'";

// The frame that runs user-written modules: inline code only, no network, its own opaque origin, only inside this page.
const FRAME_CSP = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; " +
  "base-uri 'none'; form-action 'none'; sandbox allow-scripts; frame-ancestors 'self'";

export const FRAME_PATH = "/sandbox.html";

export function secure(h: Record<string, string | number>, frame = false): Record<string, string | number> {
  return {
    ...h,
    "Content-Security-Policy": frame ? FRAME_CSP : CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": frame ? "SAMEORIGIN" : "DENY",
    "Referrer-Policy": "no-referrer",
    "Cross-Origin-Resource-Policy": "same-origin",
    ...(tls ? { "Strict-Transport-Security": "max-age=31536000" } : {}),
  };
}
