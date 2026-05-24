import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { sign } from "hono/jwt";

import { getRiderctUrl, getUserIdFromCode } from "../auth/auth";
import { clearSessionToken } from "../cookies/session";
import { COOKIE_KEYS } from "../cookies/keys";
import { CTX_KEYS } from "../auth/contextKeys";

export async function handleLogin(c: Context) {
  return c.redirect(getRiderctUrl());
}

export async function handleMe(c: Context) {
  return c.json({ userId: c.get(CTX_KEYS.userId) });
}

export async function handleLogout(c: Context) {
  clearSessionToken(c);
  return c.body(null, 204);
}

export async function handleCallback(c: Context) {
  const code = c.req.query("code");
  if (!code) return c.status(400);

  const id = await getUserIdFromCode(code);
  const week = 60 * 60 * 24 * 7;
  const token = await sign(
    { sub: id, exp: Math.floor(Date.now() / 1000) + week },
    process.env.SESSION_SECRET!,
  );

  setCookie(c, COOKIE_KEYS.session, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
  });

  return c.redirect(process.env.CLIENT_URL ?? "http://localhost:5173");
}
