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

import { getCache, setCache, resetCacheMemo } from "../../shared/cache/cache";

// "openRouterModels" is one of the fixed cache entries; it maps to Redis key
// "models:v7" with a 24h Redis TTL.
const REDIS_KEY = "models:v9";

beforeEach(() => {
  vi.clearAllMocks();
  resetCacheMemo();
});

describe("getCache", () => {
  it("returns the Redis value on a memo miss", async () => {
    mockGet.mockResolvedValueOnce({ some: "catalog" });

    const result = await getCache("openRouterModels");

    expect(result).toEqual({ some: "catalog" });
    expect(mockGet).toHaveBeenCalledWith(REDIS_KEY);
  });

  it("serves the memo on a second read without touching Redis", async () => {
    mockGet.mockResolvedValueOnce({ some: "catalog" });

    await getCache("openRouterModels");
    const second = await getCache("openRouterModels");

    expect(second).toEqual({ some: "catalog" });
    expect(mockGet).toHaveBeenCalledTimes(1);
  });

  it("returns null on a Redis miss", async () => {
    mockGet.mockResolvedValueOnce(null);
    expect(await getCache("openRouterModels")).toBeNull();
  });

  it("returns null when the Redis read throws", async () => {
    mockGet.mockRejectedValueOnce(new Error("down"));
    expect(await getCache("openRouterModels")).toBeNull();
  });
});

describe("setCache", () => {
  it("writes Redis under the entry's key and TTL", async () => {
    mockSet.mockResolvedValueOnce(undefined);

    await setCache("openRouterModels", { some: "catalog" });

    expect(mockSet).toHaveBeenCalledWith(
      REDIS_KEY,
      { some: "catalog" },
      { ex: 24 * 60 * 60 },
    );
  });

  it("populates the memo, so the next read skips Redis", async () => {
    mockSet.mockResolvedValueOnce(undefined);

    await setCache("openRouterModels", { some: "catalog" });
    const read = await getCache("openRouterModels");

    expect(read).toEqual({ some: "catalog" });
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("swallows a Redis write failure", async () => {
    mockSet.mockRejectedValueOnce(new Error("down"));
    await expect(setCache("openRouterModels", {})).resolves.toBeUndefined();
  });
});
