import { RedisStore } from "hono-rate-limiter";
import { RateLimitStoreUnavailableError } from "./errors";
import { getRedisClient } from "../../../shared/redis";

async function wrapStoreMethod<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (cause) {
    throw new RateLimitStoreUnavailableError(cause);
  }
}

// TODO: evaluate an in-memory store instead of Redis. The API runs as a single
// instance (see ARCHITECTURE), so an in-process counter would be exact and would
// drop the per-request Upstash REST round-trip this store adds before every
// handler. Revisit before scaling the API horizontally, where a shared store is
// required again.
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
