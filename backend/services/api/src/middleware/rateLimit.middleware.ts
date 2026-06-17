import type { Context, MiddlewareHandler } from "hono";
import { rateLimiter } from "hono-rate-limiter";
import { getConnInfo } from "@hono/node-server/conninfo";
import { createRateLimitStore } from "../rateLimit/storage";
import { RateLimitStoreUnavailableError } from "../rateLimit/errors";
import { CTX_KEYS } from "../auth/contextKeys";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

const rateLimitMessage = {
  message: "Too many requests, please try again later.",
};

const rateLimitUnavailableMessage = {
  message: "Rate limiting is temporarily unavailable. Please try again later.",
};

function getClientIpKey(c: Context): string {
  try {
    const address = getConnInfo(c).remote.address;
    if (address) return address;
  } catch {
    // Tests / non-Node adapters may not have socket info
  }
  return "unknown";
}
function getUserId(c: Context): string {
  const userId = c.get(CTX_KEYS.userId);
  if (typeof userId !== "string" || userId.length === 0)
    throw new Error(
      "Rate limiter requires authenticated userId; mount requireAuth before the rate limiter",
    );

  return userId;
}

function withStoreUnavailableHandler(
  limiter: MiddlewareHandler,
): MiddlewareHandler {
  return async (c, next) => {
    try {
      return await limiter(c, next);
    } catch (error) {
      if (error instanceof RateLimitStoreUnavailableError) {
        console.error("Rate limit store error:", error.cause);
        return c.json(rateLimitUnavailableMessage, 503);
      }
      throw error;
    }
  };
}

function createLimiter(
  limit: number,
  prefix: string,
  keyGenerator: (c: Context) => string,
  options?: { skip?: (c: Context) => boolean },
) {
  const limiter = rateLimiter({
    windowMs: FIFTEEN_MINUTES_MS,
    limit,
    standardHeaders: "draft-6",
    keyGenerator,
    store: createRateLimitStore(prefix),
    message: rateLimitMessage,
    skip: options?.skip ?? (() => false),
  });
  return withStoreUnavailableHandler(limiter);
}

function createAuthIpLimiter(limit: number, route: string) {
  return createLimiter(limit, `rate-limit:auth:${route}:`, getClientIpKey);
}

export const authLoginRateLimiter = createAuthIpLimiter(60, "login");
export const authCallbackRateLimiter = createAuthIpLimiter(20, "callback");
export const authLogoutRateLimiter = createAuthIpLimiter(60, "logout");
export const authMeRateLimiter = createAuthIpLimiter(200, "me");

export const jobRateLimiter = createLimiter(100, "rate-limit:job:", getUserId);

export const modelRateLimiter = createLimiter(
  100,
  "rate-limit:model:",
  getUserId,
);

export const uploadRateLimiter = createLimiter(
  30,
  "rate-limit:upload:",
  getUserId,
);
