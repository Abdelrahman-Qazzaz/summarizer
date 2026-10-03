import { isIP } from "node:net";
import type { Context } from "hono";
import { MemoryStore, rateLimiter } from "hono-rate-limiter";
import { getConnInfo } from "@hono/node-server/conninfo";
import {
  RATE_LIMIT_POLICIES,
  type RateLimitKey,
  type RateLimitName,
} from "../rateLimit/policies";
import { CTX_KEYS } from "../../../shared/keys";

const rateLimitMessage = {
  message: "Too many requests, please try again later.",
};

/**
 * The client's IP, as Railway's edge proxy reports it in X-Real-IP: the one
 * client-IP header Railway documents, and one it doesn't let clients set.
 * The socket's peer is Railway's proxy for every request, so keying on it
 * would put every user in one bucket.
 *
 * With Railway's CDN in the path, X-Real-IP has been seen holding the CDN
 * edge's address instead; that over-limits users sharing an edge, but never
 * lets a client pick its own key. A value that isn't a single IP (a
 * duplicated header arrives joined with ", ") isn't trusted. Without Railway
 * in front, as in local development, the socket address is the client.
 */
function getClientIpKey(c: Context): string {
  const realIp = c.req.header("x-real-ip")?.trim();
  if (realIp && isIP(realIp)) return realIp;

  // TODO: log warning that we're not using x-real-ip.
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

const keyOf: Record<RateLimitKey, (c: Context) => string> = {
  clientIp: getClientIpKey,
  userId: getUserId,
};

const stores: MemoryStore[] = [];

/**
 * A policy from policies.ts as middleware, counting in this process's memory.
 * The API runs as one instance, so the counts are exact and no request waits
 * on a round trip to a shared store. With several instances each would count
 * on its own; see MESSAGE_LATENCY.md before scaling out.
 */
function createLimiter(name: RateLimitName) {
  const { limit, windowMs, key } = RATE_LIMIT_POLICIES[name];
  const store = new MemoryStore();
  stores.push(store);

  return rateLimiter({
    windowMs,
    limit,
    standardHeaders: "draft-6",
    keyGenerator: keyOf[key],
    store,
    message: rateLimitMessage,
  });
}

export const authLoginRateLimiter = createLimiter("authLogin");
export const authCallbackRateLimiter = createLimiter("authCallback");
export const authLogoutRateLimiter = createLimiter("authLogout");
export const authMeRateLimiter = createLimiter("authMe");
export const authRefreshRateLimiter = createLimiter("authRefresh");

export const jobRateLimiter = createLimiter("job");
export const conversationRateLimiter = createLimiter("conversation");
export const modelRateLimiter = createLimiter("model");
export const imageReadRateLimiter = createLimiter("imageRead");
export const uploadRateLimiter = createLimiter("upload");
export const uploadConfirmRateLimiter = createLimiter("uploadConfirm");

/** Test-only: clears every count, so cases don't spend each other's budgets. */
export function resetRateLimits() {
  for (const store of stores) store.resetAll();
}
