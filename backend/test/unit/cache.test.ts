import { describe, it, expect, vi, beforeEach } from "vitest";

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
  setCache,
  resetCacheMemo,
} from "../../shared/cache/cache";

// OpenRouter's catalog maps to Redis key "models:v9" with a 24h Redis TTL.
const REDIS_KEY = "models:v9";

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
