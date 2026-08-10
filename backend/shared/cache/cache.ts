import { getRedisClient } from "./redis";
import { logger } from "../logger";
import { tryCatch } from "../try-catch";

/**
 * The fixed set of cache entries. Each carries its Redis key and the two TTLs
 * that govern it: how long Redis holds the value, and how long a process serves
 * it from memory before consulting Redis again. The memo TTL stays far under the
 * Redis TTL, so the in-process copy is never the staler of the two; each process
 * holds its own. A day-long Redis entry keeps a newly listed model from waiting
 * on a hand-bumped key version.
 */
const CACHE_ENTRIES = {
  openRouterModels: {
    redisKey: "models:v7",
    redisTtlSeconds: 24 * 60 * 60,
    memoTtlMs: 5 * 60 * 1000,
  },
  deepgramTranscribeModels: {
    redisKey: "transcribe-models:v1",
    redisTtlSeconds: 24 * 60 * 60,
    memoTtlMs: 5 * 60 * 1000,
  },
} as const;

type CacheName = keyof typeof CACHE_ENTRIES;

const memo = new Map<CacheName, { data: unknown; expiresAt: number }>();

/**
 * Serves the in-process memo until it expires, otherwise reads Redis (whose hit
 * repopulates the memo). Returns null on a miss or a Redis read failure — the
 * miss every caller expects.
 */
export async function getCache<T>(name: CacheName): Promise<T | null> {
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
 */
export async function setCache<T>(name: CacheName, data: T): Promise<void> {
  const entry = CACHE_ENTRIES[name];
  memo.set(name, { data, expiresAt: Date.now() + entry.memoTtlMs });

  const { error } = await tryCatch(
    getRedisClient().set(entry.redisKey, data, { ex: entry.redisTtlSeconds }),
  );
  if (error) logger.error("Cache write failed", error, { cacheKey: entry.redisKey });
}

/** Test-only: drops the in-process memo so cases don't leak entries into each other. */
export function resetCacheMemo() {
  memo.clear();
}
