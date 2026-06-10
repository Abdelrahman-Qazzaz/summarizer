import { RateLimitStoreUnavailableError } from "../../services/api/src/rateLimit/errors";

const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

type Entry = { totalHits: number; resetTime: Date };

const stores = new Map<string, Entry>();
let storeUnavailable = false;

function storeKey(prefix: string, key: string): string {
  return `${prefix}${key}`;
}

export function resetRateLimitMock(): void {
  stores.clear();
  storeUnavailable = false;
}

export function setRateLimitStoreUnavailable(unavailable: boolean): void {
  storeUnavailable = unavailable;
}

export function createMockRateLimitStore(prefix: string) {
  let windowMs = FIFTEEN_MINUTES_MS;

  return {
    init(options: { windowMs: number }) {
      windowMs = options.windowMs;
    },
    async increment(key: string) {
      if (storeUnavailable) {
        throw new RateLimitStoreUnavailableError(new Error("redis down"));
      }
      const id = storeKey(prefix, key);
      const now = Date.now();
      let entry = stores.get(id);
      if (!entry || entry.resetTime.getTime() <= now) {
        entry = { totalHits: 0, resetTime: new Date(now + windowMs) };
      }
      entry.totalHits += 1;
      stores.set(id, entry);
      return { totalHits: entry.totalHits, resetTime: entry.resetTime };
    },
    async decrement(key: string) {
      if (storeUnavailable) {
        throw new RateLimitStoreUnavailableError(new Error("redis down"));
      }
      const id = storeKey(prefix, key);
      const entry = stores.get(id);
      if (entry && entry.totalHits > 0) entry.totalHits -= 1;
    },
    async resetKey(key: string) {
      if (storeUnavailable) {
        throw new RateLimitStoreUnavailableError(new Error("redis down"));
      }
      stores.delete(storeKey(prefix, key));
    },
  };
}
