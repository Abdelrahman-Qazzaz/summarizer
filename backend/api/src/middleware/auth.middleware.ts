import { createMiddleware } from "hono/factory";
import { getCookie } from "hono/cookie";

import { COOKIE_KEYS, CTX_KEYS } from "../../../shared/keys";
import { logger } from "../../../shared/logger";
import { verifySessionToken } from "../auth/sessionToken";

export const requireAuth = createMiddleware(async (c, next) => {
  const token = getCookie(c, COOKIE_KEYS.session);
  if (!token) return c.json({ message: "Unauthorized" }, 401);
  try {
    const { userId } = await verifySessionToken(token);
    c.set(CTX_KEYS.userId, userId);
    await next();
  } catch (error) {
    logger.debug("Session token verification failed", { error: String(error) });
    return c.json({ message: "Unauthorized" }, 401);
  }
});
