import type { Context } from "hono";
import { deleteCookie, setCookie } from "hono/cookie";
import { COOKIE_KEYS } from "../../../shared/keys";
import { getApiEnv } from "../../../shared/env";

/**
 * In production the client and the API sit on different registrable domains —
 * each Railway service gets its own `*.up.railway.app` host, and `railway.app`
 * is a public suffix — so the browser treats every client → API call as
 * cross-site and refuses to attach a `Lax` cookie. `None` is the only value
 * that survives that, and browsers only honour it alongside `Secure`, which is
 * why both derive from one flag rather than being set independently.
 *
 * Locally the two share `localhost`, where `Lax` applies and `Secure` would
 * stop the cookie being stored at all over plain HTTP.
 *
 * Cross-site cookies are forgeable by design, so `csrf()` in app.ts guards the
 * mutating routes this opens up.
 */
function sessionCookieOptions() {
  const crossSite = getApiEnv().NODE_ENV === "production";
  return {
    httpOnly: true,
    secure: crossSite,
    sameSite: crossSite ? ("None" as const) : ("Lax" as const),
    path: "/",
  };
}

export function setSessionToken(c: Context, token: string): void {
  setCookie(c, COOKIE_KEYS.session, token, sessionCookieOptions());
}

/**
 * The attributes have to match the ones the cookie was set with, or the
 * browser treats this as a different cookie and keeps the original.
 */
export function clearSessionToken(c: Context): void {
  deleteCookie(c, COOKIE_KEYS.session, sessionCookieOptions());
}
