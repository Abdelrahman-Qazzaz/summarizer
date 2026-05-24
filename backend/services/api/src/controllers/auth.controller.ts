import type { Context } from "hono";
import { setCookie } from "hono/cookie";
import { sign } from "hono/jwt";

import { getRiderctUrl, getUserIdFromCode } from "../auth/auth";
import { COOKIE_KEYS } from "../cookies/keys";

export async function handleLogin(c: Context) {
  c.redirect(getRiderctUrl());
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
