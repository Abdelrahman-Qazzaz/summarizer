import type { Context } from "hono";
import { getCookie } from "hono/cookie";
import { sign, verify } from "hono/jwt";

import { getApiEnv } from "../../../shared/env";
import {
  getAuthSessionFromCode,
  getRiderctUrl,
  revokeAuthSession,
} from "../auth/auth";
import { clearSessionToken, setSessionToken } from "../cookies/session";

import { COOKIE_KEYS, CTX_KEYS } from "../../../shared/keys";
import { ensureUser } from "../data/users.data";
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

  let sessionId: string | undefined;
  try {
    const payload = await verify(token, getApiEnv().SESSION_SECRET, "HS256");
    if (typeof payload.sid === "string") sessionId = payload.sid;
  } catch {
    return c.json(null, 200);
  }

  if (sessionId) {
    try {
      await revokeAuthSession(sessionId);
    } catch (error) {
      log.error("Failed to revoke WorkOS session", error);
    }
  }

  return c.json(null, 200);
}

export async function handleCallback(c: Context) {
  const code = c.req.query("code");
  if (!code) return c.json({ message: "code required" }, 400);

  const { userId, sessionId } = await getAuthSessionFromCode(code);

  const week = 60 * 60 * 24 * 7;
  // Upserting the user row and signing the session token are independent;
  // both must still succeed before the cookie is issued.
  const [, token] = await Promise.all([
    ensureUser(userId),
    sign(
      {
        sub: userId,
        sid: sessionId,
        exp: Math.floor(Date.now() / 1000) + week,
      },
      getApiEnv().SESSION_SECRET,
    ),
  ]);

  setSessionToken(c, token);

  return c.redirect(getApiEnv().CLIENT_URL);
}
