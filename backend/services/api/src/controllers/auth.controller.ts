import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { sign } from "hono/jwt";

import { getApiEnv } from "../../../../shared/env";
import { getRiderctUrl, getUserIdFromCode } from "../auth/auth";
import { clearSessionToken } from "../cookies/session";

import { COOKIE_KEYS, CTX_KEYS } from "../../../../shared/keys";
import { db, users } from "../../../../shared/db";

export async function handleLogin(c: Context) {
  return c.redirect(getRiderctUrl());
}

export async function handleMe(c: Context) {
  return c.json({ userId: c.get(CTX_KEYS.userId) });
}

export async function handleLogout(c: Context) {
  clearSessionToken(c);
  return c.json(null, 200);
}

export async function handleCallback(c: Context) {
  const code = c.req.query("code");
  if (!code) return c.json({ message: "code required" }, 400);

  const id = await getUserIdFromCode(code);
  await db.insert(users).values({ id }).onConflictDoNothing();

  const week = 60 * 60 * 24 * 7;
  const token = await sign(
    { sub: id, exp: Math.floor(Date.now() / 1000) + week },
    getApiEnv().SESSION_SECRET,
  );

  setCookie(c, COOKIE_KEYS.session, token, {
    httpOnly: true,
    secure: getApiEnv().NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
  });

  return c.redirect(getApiEnv().CLIENT_URL);
}
