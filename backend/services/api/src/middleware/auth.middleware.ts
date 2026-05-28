import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { getApiEnv } from "../../../../shared/env";
import { COOKIE_KEYS } from "../cookies/keys";
import { CTX_KEYS } from "../auth/contextKeys";

export const requireAuth = createMiddleware(async (c, next) => {
  const token = getCookie(c, COOKIE_KEYS.session);
  if (!token) return c.json({ message: "Unauthorized" }, 401);
  try {
    const payload = await verify(token, getApiEnv().SESSION_SECRET, "HS256");
    const userId = payload.sub;
    if (typeof userId !== "string") {
      return c.json({ message: "Unauthorized" }, 401);
    }
    c.set(CTX_KEYS.userId, userId);
    await next();
  } catch {
    return c.json({ message: "Unauthorized" }, 401);
  }
});
