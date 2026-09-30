import type { Context } from "hono";
import { getCookie } from "hono/cookie";

import { getApiEnv } from "../../../shared/env";
import {
  getAuthSessionFromCode,
  getRiderctUrl,
  revokeAuthSession,
} from "../auth/auth";
import { verifyAccessToken } from "../auth/accessToken";
import { refreshSession } from "../auth/refreshSession";
import {
  clearRefreshToken,
  clearSessionToken,
  setRefreshToken,
  setSessionToken,
} from "../cookies/session";

import { COOKIE_KEYS, CTX_KEYS } from "../../../shared/keys";
import { data } from "../../../shared/data";
import { logger } from "../../../shared/logger";

const log = logger.child({ controller: "auth" });

export async function handleLogin(c: Context) {
  return c.redirect(getRiderctUrl());
}

/** When an access token expires, as the auth responses report it. */
function expiresAt(epochSeconds: number) {
  return new Date(epochSeconds * 1000).toISOString();
}

/**
 * Who is signed in, and when their access token expires, so the client can
 * refresh it before then.
 */
export async function handleMe(c: Context) {
  return c.json({
    userId: c.get(CTX_KEYS.userId),
    expiresAt: expiresAt(c.get(CTX_KEYS.sessionExpiresAtEpochSeconds)),
  });
}

/**
 * Whether WorkOS turned the refresh token down, as opposed to failing to
 * answer: it answers a spent, revoked or expired one with a 4xx.
 */
function isRejectedByWorkos(error: unknown) {
  const { status } = error as { status?: unknown };
  return (
    typeof status === "number" &&
    status >= 400 &&
    status < 500 &&
    status !== 429
  );
}

/**
 * Trades the refresh cookie for a new access token and refresh token, and
 * answers who the session is for and when the new access token expires, so
 * the client can refresh again before it does. A refresh token WorkOS turns
 * down means the session is over: both cookies are cleared and the answer
 * is a 401, which the client reads as signed out.
 */
export async function handleRefresh(c: Context) {
  const refreshToken = getCookie(c, COOKIE_KEYS.refresh);
  if (!refreshToken) return c.json({ message: "Unauthorized" }, 401);

  let tokens: Awaited<ReturnType<typeof refreshSession>>;
  try {
    tokens = await refreshSession(refreshToken);
  } catch (error) {
    if (!isRejectedByWorkos(error)) throw error;
    log.debug("WorkOS refused a refresh token", { error: String(error) });
    clearSessionToken(c);
    clearRefreshToken(c);
    return c.json({ message: "Unauthorized" }, 401);
  }

  const { userId, expiresAtEpochSeconds } = await verifyAccessToken(
    tokens.accessToken,
  );
  setSessionToken(c, tokens.accessToken);
  setRefreshToken(c, tokens.refreshToken);
  return c.json({ userId, expiresAt: expiresAt(expiresAtEpochSeconds) });
}

export async function handleLogout(c: Context) {
  const token = getCookie(c, COOKIE_KEYS.session);
  clearSessionToken(c);
  clearRefreshToken(c);

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

  const { userId, accessToken, refreshToken } =
    await getAuthSessionFromCode(code);

  await data.users.ensureUser(userId);
  setSessionToken(c, accessToken);
  setRefreshToken(c, refreshToken);

  return c.redirect(getApiEnv().CLIENT_URL);
}
