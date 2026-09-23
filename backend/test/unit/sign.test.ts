import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = vi.hoisted(() => ({
  createSignedUrl: vi.fn(),
  createSignedUrls: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => storage } }),
}));

import { sign } from "../../shared/storage/sign";

const USER = "user_01";
const WEEK = 7 * 24 * 60 * 60;
const HOUR = 60 * 60;

const audio = { kind: "audio", uploadId: "a1" } as const;
const image = { kind: "image", uploadId: "i1" } as const;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("url", () => {
  beforeEach(() => {
    storage.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed" },
      error: null,
    });
  });

  it("signs audio for an hour", async () => {
    await sign.url(USER, audio);

    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      "user_01/audios/a1",
      HOUR,
    );
  });

  it("signs an image for a week", async () => {
    await sign.url(USER, image);

    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      "user_01/images/i1",
      WEEK,
    );
  });
});

describe("urls", () => {
  it("signs each kind in its own request with its own TTL, across owners", async () => {
    storage.createSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://${path}` })),
      error: null,
    }));

    const urls = await sign.urls([
      { userId: "user_01", ...image },
      { userId: "user_01", ...audio },
      { userId: "user_02", kind: "image", uploadId: "i2" },
    ]);

    expect(storage.createSignedUrls).toHaveBeenCalledTimes(2);
    expect(storage.createSignedUrls).toHaveBeenCalledWith(
      ["user_01/images/i1", "user_02/images/i2"],
      WEEK,
    );
    expect(storage.createSignedUrls).toHaveBeenCalledWith(
      ["user_01/audios/a1"],
      HOUR,
    );
    expect(urls).toEqual(
      new Map([
        ["i1", "https://user_01/images/i1"],
        ["i2", "https://user_02/images/i2"],
        ["a1", "https://user_01/audios/a1"],
      ]),
    );
  });

  it("leaves out what storage couldn't sign", async () => {
    storage.createSignedUrls.mockResolvedValue({
      data: [{ path: "user_01/images/i1", signedUrl: "" }],
      error: null,
    });

    const urls = await sign.urls([{ userId: "user_01", ...image }]);

    expect(urls.size).toBe(0);
  });

  it("makes no request for an empty list", async () => {
    expect(await sign.urls([])).toEqual(new Map());
    expect(storage.createSignedUrls).not.toHaveBeenCalled();
  });

  it("fails if any kind's request fails", async () => {
    storage.createSignedUrls.mockImplementation(async (paths: string[]) =>
      paths[0].includes("/audios/")
        ? { data: null, error: new Error("audio signing failed") }
        : { data: [], error: null },
    );

    await expect(
      sign.urls([
        { userId: "user_01", ...image },
        { userId: "user_01", ...audio },
      ]),
    ).rejects.toThrow("audio signing failed");
  });
});
