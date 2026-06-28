import { Redis } from "@upstash/redis";
import { getApiEnv } from "./env";
import { logger } from "./logger";
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
  try {
    const hit = await getRedisClient().get<unknown>(cacheKey);
    return hit;
  } catch (error) {
    logger.error("Cache read failed", error, { cacheKey });
    return null;
  }
}
export async function setCache(
  cacheKey: RedisCacheOptions["key"],
  data: unknown,
) {
  try {
    await getRedisClient().set(cacheKey, data);
  } catch (error) {
    logger.error("Cache write failed", error, { cacheKey });
  }
}
