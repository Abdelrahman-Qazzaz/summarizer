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

import { checkCache, setCache } from "../../shared/redis";

describe("checkCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cached value when get succeeds", async () => {
    const cached = { foo: "bar" };
    mockGet.mockResolvedValueOnce(cached);

    const result = await checkCache("models:v1");

    expect(result).toEqual(cached);
    expect(mockGet).toHaveBeenCalledWith("models:v1");
  });

  it("returns null when get throws", async () => {
    mockGet.mockRejectedValueOnce(new Error("redis down"));

    const result = await checkCache("models:v1");

    expect(result).toBeNull();
  });
});

describe("setCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("writes data to redis", async () => {
    const data = { models: [] };
    mockSet.mockResolvedValueOnce("OK");

    await setCache("models:v1", data);

    expect(mockSet).toHaveBeenCalledWith("models:v1", data);
  });

  it("does not throw when set rejects", async () => {
    mockSet.mockRejectedValueOnce(new Error("redis down"));

    await expect(setCache("models:v1", {})).resolves.toBeUndefined();
  });
});
