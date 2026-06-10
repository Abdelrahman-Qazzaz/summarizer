import { Redis } from "@upstash/redis";
import { RedisStore } from "hono-rate-limiter";
import { getApiEnv } from "../../../../shared/env";
import { RateLimitStoreUnavailableError } from "./errors";

let client: Redis | undefined;

function getRedisClient(): Redis {
  const env = getApiEnv();
  client ??= new Redis({
    url: env.UPSTASH_REDIS_REST_URL,
    token: env.UPSTASH_REDIS_REST_TOKEN,
  });
  return client;
}

async function wrapStoreMethod<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new RateLimitStoreUnavailableError(cause);
  }
}

export function createRateLimitStore(prefix: string) {
  const inner = new RedisStore({
    client: getRedisClient(),
    prefix,
  });

  return {
    init: inner.init.bind(inner),
    get: inner.get
      ? (key: string) => wrapStoreMethod(() => inner.get!(key))
      : undefined,
    increment: (key: string) => wrapStoreMethod(() => inner.increment(key)),
    decrement: (key: string) => wrapStoreMethod(() => inner.decrement(key)),
    resetKey: (key: string) => wrapStoreMethod(() => inner.resetKey(key)),
  };
}
