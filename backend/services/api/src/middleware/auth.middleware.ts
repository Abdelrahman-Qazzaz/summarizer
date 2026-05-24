import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";
import { verify } from "hono/jwt";
import { COOKIE_KEYS } from "../cookies/keys";

export type AuthEnv = {
  Variables: {
    userId: string;
  };
};

export const requireAuth = createMiddleware<AuthEnv>(async (c, next) => {
  const token = getCookie(c, COOKIE_KEYS.session);
  if (!token) return c.json({ message: "Unauthorized" }, 401);
  try {
    const payload = await verify(token, process.env.SESSION_SECRET!, "HS256");
    const userId = payload.sub;
    if (typeof userId !== "string") {
      return c.json({ message: "Unauthorized" }, 401);
    }
    c.set("userId", userId);
    await next();
  } catch {
    return c.json({ message: "Unauthorized" }, 401);
  }
});
