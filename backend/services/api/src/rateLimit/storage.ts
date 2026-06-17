import { RedisStore } from "hono-rate-limiter";
import { RateLimitStoreUnavailableError } from "./errors";
import { getRedisClient } from "../../../../shared/redis";

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
