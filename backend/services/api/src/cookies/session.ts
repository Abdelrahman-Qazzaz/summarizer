import type { Context } from "hono";
import { deleteCookie } from "hono/cookie";
import { COOKIE_KEYS } from "../../../../shared/keys";

export function clearSessionToken(c: Context): void {
  deleteCookie(c, COOKIE_KEYS.session, { path: "/" });
}
