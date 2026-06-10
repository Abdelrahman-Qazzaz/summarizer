import { Redis } from "@upstash/redis";
import { RedisStore } from "hono-rate-limiter";
import { getApiEnv } from "../../../../shared/env";

let client: Redis | undefined;

function getRedisClient(): Redis {
  const env = getApiEnv();
  client ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return client;
}

export function createRateLimitStore(prefix: string) {
  return new RedisStore({
    client: getRedisClient(),
    prefix,
  });
}
