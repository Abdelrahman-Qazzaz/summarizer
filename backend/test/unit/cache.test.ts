import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { mockGet, mockSet } = vi.hoisted(() => ({
  mockGet: vi.fn(),
  mockSet: vi.fn(),
}));

vi.mock("@upstash/redis", () => ({
  Redis: class {
    get = mockGet;
    set = mockSet;
  },
}));

import {
  CACHE_KEYS,
  getCache,
  getOrSetCache,
  setCache,
  resetCacheMemo,
} from "../../shared/cache/cache";

// OpenRouter's catalog maps to Redis key "models:v9" with a 24h Redis TTL.
const REDIS_KEY = "models:v9";
const MEMO_TTL_MS = 5 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  resetCacheMemo();
});

describe("getCache", () => {
  it("returns the Redis value on a memo miss", async () => {
    mockGet.mockResolvedValueOnce({ some: "catalog" });

    const result = await getCache(CACHE_KEYS.openRouterModels);

    expect(result).toEqual({ some: "catalog" });
    expect(mockGet).toHaveBeenCalledWith(REDIS_KEY);
  });

  it("serves the memo on a second read without touching Redis", async () => {
    mockGet.mockResolvedValueOnce({ some: "catalog" });

    await getCache(CACHE_KEYS.openRouterModels);
    const second = await getCache(CACHE_KEYS.openRouterModels);

    expect(second).toEqual({ some: "catalog" });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("returns null on a Redis miss", async () => {
    mockGet.mockResolvedValueOnce(null);
    expect(await getCache(CACHE_KEYS.openRouterModels)).toBeNull();
  });

  it("returns null when the Redis read throws", async () => {
    mockGet.mockRejectedValueOnce(new Error("down"));
    expect(await getCache(CACHE_KEYS.openRouterModels)).toBeNull();
  });
});

describe("setCache", () => {
  it("writes Redis under the entry's key and TTL", async () => {
    mockSet.mockResolvedValueOnce(undefined);

    await setCache(CACHE_KEYS.openRouterModels, { some: "catalog" });

    expect(mockSet).toHaveBeenCalledWith(
      REDIS_KEY,
      { some: "catalog" },
      { ex: 24 * 60 * 60 },
    );
  });

  it("populates the memo, so the next read skips Redis", async () => {
    mockSet.mockResolvedValueOnce(undefined);

    await setCache(CACHE_KEYS.openRouterModels, { some: "catalog" });
    const read = await getCache(CACHE_KEYS.openRouterModels);

    expect(read).toEqual({ some: "catalog" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("swallows a Redis write failure", async () => {
    mockSet.mockRejectedValueOnce(new Error("down"));
    await expect(
      setCache(CACHE_KEYS.openRouterModels, {}),
    ).resolves.toBeUndefined();
  });
});

describe("getOrSetCache", () => {
  it("returns a hit without fetching", async () => {
    mockGet.mockResolvedValueOnce({ some: "catalog" });
    const fetch = vi.fn();

    expect(await getOrSetCache(CACHE_KEYS.openRouterModels, fetch)).toEqual({
      some: "catalog",
    });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fetches on a miss and writes both tiers", async () => {
    mockGet.mockResolvedValueOnce(null);
    mockSet.mockResolvedValueOnce(undefined);

    const result = await getOrSetCache(
      CACHE_KEYS.openRouterModels,
      async () => ({
        some: "catalog",
      }),
    );

    expect(result).toEqual({ some: "catalog" });
    expect(mockSet).toHaveBeenCalledWith(
      REDIS_KEY,
      { some: "catalog" },
      { ex: 24 * 60 * 60 },
    );
  });

  it("shares one fetch between callers that miss together", async () => {
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);
    const fetch = vi.fn(async () => ({ some: "catalog" }));

    const [first, second] = await Promise.all([
      getOrSetCache(CACHE_KEYS.openRouterModels, fetch),
      getOrSetCache(CACHE_KEYS.openRouterModels, fetch),
    ]);

    expect(fetch).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
  });

  it("keeps each key's fetch separate", async () => {
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);

    const [models, transcribeModels] = await Promise.all([
      getOrSetCache(CACHE_KEYS.openRouterModels, async () => "models"),
      getOrSetCache(
        CACHE_KEYS.deepgramTranscribeModels,
        async () => "transcribe-models",
      ),
    ]);

    expect(models).toBe("models");
    expect(transcribeModels).toBe("transcribe-models");
  });

  it("rejects every waiter and fetches again after a failure", async () => {
    mockGet.mockResolvedValue(null);
    mockSet.mockResolvedValue(undefined);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream is down"))
      .mockResolvedValueOnce({ some: "catalog" });

    const [first, second] = await Promise.allSettled([
      getOrSetCache(CACHE_KEYS.openRouterModels, fetch),
      getOrSetCache(CACHE_KEYS.openRouterModels, fetch),
    ]);

    expect(first).toMatchObject({ reason: new Error("upstream is down") });
    expect(second).toMatchObject({ reason: new Error("upstream is down") });
    expect(fetch).toHaveBeenCalledTimes(1);

    expect(await getOrSetCache(CACHE_KEYS.openRouterModels, fetch)).toEqual({
      some: "catalog",
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});

describe("getOrSetCache once the memo has expired", () => {
  const STALE = { serveStale: true };

  beforeEach(async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    mockGet.mockResolvedValueOnce("old catalog");
    await getOrSetCache(CACHE_KEYS.openRouterModels, vi.fn(), STALE);
    vi.advanceTimersByTime(MEMO_TTL_MS + 1);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("waits for the refresh without serveStale", async () => {
    mockGet.mockResolvedValueOnce("new catalog");

    expect(await getOrSetCache(CACHE_KEYS.openRouterModels, vi.fn())).toBe(
      "new catalog",
    );
  });

  it("serves the old value without waiting on the refresh", async () => {
    const refreshed = Promise.withResolvers<unknown>();
    mockGet.mockReturnValueOnce(refreshed.promise);

    expect(
      await getOrSetCache(CACHE_KEYS.openRouterModels, vi.fn(), STALE),
    ).toBe("old catalog");

    refreshed.resolve("new catalog");
    await vi.waitFor(async () =>
      expect(
        await getOrSetCache(CACHE_KEYS.openRouterModels, vi.fn(), STALE),
      ).toBe("new catalog"),
    );
  });

  it("fetches in the background when Redis misses", async () => {
    mockGet.mockResolvedValueOnce(null);
    mockSet.mockResolvedValueOnce(undefined);
    const fetch = vi.fn(async () => "new catalog");

    expect(await getOrSetCache(CACHE_KEYS.openRouterModels, fetch, STALE)).toBe(
      "old catalog",
    );

    await vi.waitFor(() =>
      expect(mockSet).toHaveBeenCalledWith(REDIS_KEY, "new catalog", {
        ex: 24 * 60 * 60,
      }),
    );
    expect(await getOrSetCache(CACHE_KEYS.openRouterModels, fetch, STALE)).toBe(
      "new catalog",
    );
  });

  it("keeps serving the old value when the refresh fails, and retries", async () => {
    mockGet.mockResolvedValue(null);
    const fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("upstream is down"))
      .mockResolvedValueOnce("new catalog");

    expect(await getOrSetCache(CACHE_KEYS.openRouterModels, fetch, STALE)).toBe(
      "old catalog",
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(1));

    expect(await getOrSetCache(CACHE_KEYS.openRouterModels, fetch, STALE)).toBe(
      "old catalog",
    );
    await vi.waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await vi.waitFor(async () =>
      expect(
        await getOrSetCache(CACHE_KEYS.openRouterModels, fetch, STALE),
      ).toBe("new catalog"),
    );
  });

  it("starts one refresh for callers that find it expired together", async () => {
    const refreshed = Promise.withResolvers<unknown>();
    mockGet.mockReturnValueOnce(refreshed.promise);

    await Promise.all([
      getOrSetCache(CACHE_KEYS.openRouterModels, vi.fn(), STALE),
      getOrSetCache(CACHE_KEYS.openRouterModels, vi.fn(), STALE),
    ]);
    refreshed.resolve("new catalog");

    expect(mockGet).toHaveBeenCalledTimes(2);
  });
});
