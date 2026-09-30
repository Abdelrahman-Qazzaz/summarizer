import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import { getApiEnv } from "../../../shared/env";
import {
  getAuthSessionFromCode,
  getRiderctUrl,
  revokeAuthSession,
} from "../auth/auth";
import { verifyAccessToken } from "../auth/accessToken";
import { clearSessionToken, setSessionToken } from "../cookies/session";

import { COOKIE_KEYS, CTX_KEYS } from "../../../shared/keys";
import { data } from "../../../shared/data";
import { logger } from "../../../shared/logger";

const log = logger.child({ controller: "auth" });

export async function handleLogin(c: Context) {
  return c.redirect(getRiderctUrl());
}

export async function handleMe(c: Context) {
  return c.json({ userId: c.get(CTX_KEYS.userId) });
}

export async function handleLogout(c: Context) {
  const token = getCookie(c, COOKIE_KEYS.session);
  clearSessionToken(c);

  if (!token) return c.json(null, 200);

  // The token has usually expired by the time someone logs out; it's still
  // what names the session to end.
  let sessionId: string;
  try {
    ({ sessionId } = await verifyAccessToken(token, { allowExpired: true }));
  } catch {
    return c.json(null, 200);
  }

  try {
    await revokeAuthSession(sessionId);
  } catch (error) {
    log.error("Failed to revoke WorkOS session", error);
  }

  return c.json(null, 200);
}

export async function handleCallback(c: Context) {
  const code = c.req.query("code");
  if (!code) return c.json({ message: "code required" }, 400);

  const { userId, accessToken } = await getAuthSessionFromCode(code);

  await data.users.ensureUser(userId);
  setSessionToken(c, accessToken);

  return c.redirect(getApiEnv().CLIENT_URL);
}
