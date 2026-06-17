import { createMiddleware } from "hono/factory";
import { getRedisClient } from "../../../../shared/redis";
import type { Context } from "hono";

type RedisCacheOptions = {
  /** Static key or per-request key (e.g. include userId if response varies) */
  key: string;
  ttlSeconds: number;
  prefix?: string; // default "cache:"
};

export function redisCache(options: RedisCacheOptions) {
  return createMiddleware(async (c, next) => {
    if (c.req.method !== "GET") return await next();

    const cacheKey = options.key;
    try {
      const hit = await getRedisClient().get<unknown>(cacheKey);
      if (hit != null) {
        c.header("X-Cache", "HIT");
        return c.json(hit);
      }
    } catch (error) {
      console.error("Cache read failed:", error);
      // fail open — continue without cache
    }

    c.header("X-Cache", "MISS");
    await next();

    if (c.res.status !== 200) return;

    try {
      const body = await c.res.clone().json();
      await getRedisClient().set(cacheKey, body, { ex: options.ttlSeconds });
    } catch (error) {
      console.error("Cache write failed:", error);
    }
  });
}
