import type { Context } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { createRateLimitStore } from "../rateLimit/storage";
import { CTX_KEYS } from "../auth/contextKeys";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const rateLimitMessage = {
  message: "Too many requests, please try again later.",
};

function createLimiter(
  limit: number,
  prefix: string,

  options?: { skip?: (c: Context) => boolean },
) {
  function keyGenerator(c: Context): string {
    const userId = c.get(CTX_KEYS.userId);
    if (typeof userId !== "string" || userId.length === 0)
      throw new Error(
        "Rate limiter requires authenticated userId; mount requireAuth before the rate limiter",
      );

    return userId;
  }
  return rateLimiter({
    windowMs: FIFTEEN_MINUTES_MS,
    limit,
    standardHeaders: "draft-6",
    keyGenerator,
    store: createRateLimitStore(prefix),
    message: rateLimitMessage,
    skip: options?.skip ?? (() => false),
  });
}

export const jobRateLimiter = createLimiter(100, "rate-limit:job:");

export const uploadRateLimiter = createLimiter(30, "rate-limit:upload:");
