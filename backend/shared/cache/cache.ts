import { getRedisClient } from "./redis";
import { logger } from "../logger";
import { tryCatch } from "../try-catch";
import { CACHE_KEYS, type CacheKey } from "./cacheKeys";

export { CACHE_KEYS } from "./cacheKeys";
export type { CacheKey } from "./cacheKeys";

/**
 * The fixed set of cache entries. Each carries its Redis key and the two TTLs
 * that govern it: how long Redis holds the value, and how long a process serves
 * it from memory before consulting Redis again. The memo TTL stays far under the
 * Redis TTL, so the in-process copy is never the staler of the two; each process
 * holds its own. A day-long Redis entry keeps a newly listed model from waiting
 * on a hand-bumped key version.
 */
const CACHE_ENTRIES = {
  [CACHE_KEYS.openRouterModels]: {
    redisKey: "models:v9",
    redisTtlSeconds: 24 * 60 * 60,
    memoTtlMs: 5 * 60 * 1000,
  },
  [CACHE_KEYS.deepgramTranscribeModels]: {
    redisKey: "transcribe-models:v1",
    redisTtlSeconds: 24 * 60 * 60,
    memoTtlMs: 5 * 60 * 1000,
  },
} as const satisfies Record<
  CacheKey,
  {
    redisKey: string;
    redisTtlSeconds: number;
    memoTtlMs: number;
  }
>;

const memo = new Map<CacheKey, { data: unknown; expiresAt: number }>();
const inFlight = new Map<CacheKey, Promise<unknown>>();

/**
 * Serves the in-process memo until it expires, otherwise reads Redis (whose hit
 * repopulates the memo). Returns null on a miss or a Redis read failure — the
 * miss every caller expects.
 */
export async function getCache<T>(name: CacheKey): Promise<T | null> {
  const entry = CACHE_ENTRIES[name];

  const memoized = memo.get(name);
  if (memoized && memoized.expiresAt > Date.now()) return memoized.data as T;

  const { data, error } = await tryCatch(
    getRedisClient().get<T>(entry.redisKey),
  );
  if (error) {
    logger.error("Cache read failed", error, { cacheKey: entry.redisKey });
    return null;
  }
  if (data != null) {
    memo.set(name, { data, expiresAt: Date.now() + entry.memoTtlMs });
    return data;
  }
  return null;
}

/**
 * Writes both tiers under the entry's fixed TTLs. A Redis failure is logged, not
 * thrown: the memo still holds the fresh value for this process.
 *
 * Exported for the cache's own tests; callers go through getOrSetCache.
 */
export async function setCache<T>(name: CacheKey, data: T): Promise<void> {
  const entry = CACHE_ENTRIES[name];
  memo.set(name, { data, expiresAt: Date.now() + entry.memoTtlMs });

  const { error } = await tryCatch(
    getRedisClient().set(entry.redisKey, data, { ex: entry.redisTtlSeconds }),
  );
  if (error)
    logger.error("Cache write failed", error, { cacheKey: entry.redisKey });
}

/**
 * The read-through path: the two cache tiers, then `fetch` on a miss. Callers
 * that miss together share one `fetch` per process instead of each starting
 * their own — the difference between one catalog fetch and one per request
 * whenever an entry expires, or whenever Redis is unreachable and every read
 * reports a miss. The shared entry is dropped once it settles, so a failed
 * fetch is retried rather than handed to every later caller.
 */
export async function getOrSetCache<T>(
  name: CacheKey,
  fetch: () => Promise<T>,
): Promise<T> {
  const hit = await getCache<T>(name);
  if (hit != null) return hit;

  const pending = inFlight.get(name);
  if (pending) return pending as Promise<T>;

  // Nothing is awaited between reading and writing inFlight, so a caller
  // resuming from its own getCache always sees this entry.
  const fetched = fetch()
    .then((data) => {
      void setCache(name, data);
      return data;
    })
    .finally(() => inFlight.delete(name));

  inFlight.set(name, fetched);
  return fetched;
}

/** Test-only: drops the in-process state so cases don't leak entries into each other. */
export function resetCacheMemo() {
  memo.clear();
  inFlight.clear();
}
