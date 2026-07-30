import { Redis } from "@upstash/redis";
import { getApiEnv } from "./env";
import { logger } from "./logger";
import { tryCatch } from "./try-catch";
import type { RedisCacheOptions } from "./types/redis.types";

let client: Redis | undefined;
export function getRedisClient(): Redis {
  const env = getApiEnv();
  client ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return client;
}

/** Startup health check: fails if Redis is unreachable or rejects the token. */
export async function pingRedis(): Promise<void> {
  await getRedisClient().ping();
}

export async function checkCache(cacheKey: RedisCacheOptions["key"]) {
  const { data, error } = await tryCatch(getRedisClient().get<unknown>(cacheKey));
  if (error) logger.error("Cache read failed", error, { cacheKey });
  // data is null on failure — exactly the miss the callers expect.
  return data;
}
/**
 * `ttlSeconds` is required, not defaulted: an entry with no expiry lives until
 * something explicitly overwrites it, which in practice meant bumping the
 * version in CACHE_KEYS by hand to bust a stale catalog. Every caller has to
 * say how long its data stays true.
 */
export async function setCache(
  cacheKey: RedisCacheOptions["key"],
  data: unknown,
  ttlSeconds: number,
) {
  const { error } = await tryCatch(
    getRedisClient().set(cacheKey, data, { ex: ttlSeconds }),
  );
  if (error) logger.error("Cache write failed", error, { cacheKey });
}
