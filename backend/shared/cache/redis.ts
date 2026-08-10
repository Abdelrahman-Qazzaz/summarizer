import { Redis } from "@upstash/redis";
import { getApiEnv } from "../env";

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
