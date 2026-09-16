import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(),
  info: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  createSignedUrls: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => storage } }),
}));

import {
  MAX_AUDIO_BYTES,
  createSignedUrl,
  createSignedUrls,
  createUploadUrl,
  deleteFromBucket,
  getTextFromBucket,
  takeUploadedObject,
} from "../../shared/bucket";

const USER = "user_01";
const IMAGE_CAP = 10 * 1024 * 1024;
const WEEK = 7 * 24 * 60 * 60;
const HOUR = 60 * 60;

const audio = { kind: "audio", uploadId: "a1" } as const;
const image = { kind: "image", uploadId: "i1" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  storage.remove.mockResolvedValue({ data: [], error: null });
});

// Every key is <userId>/<folder>/<id>. youtube-fetcher/app/bucket.py builds the
// same keys for audio and text, and the worker reads them back from here.
describe("deleteFromBucket", () => {
  it("removes a mix of kinds in one request", async () => {
    await deleteFromBucket(USER, [
      audio,
      { kind: "text", uploadId: "t1" },
      image,
    ]);

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([
      "user_01/audios/a1",
      "user_01/texts/t1",
      "user_01/images/i1",
    ]);
  });

  it("makes no request for an empty list", async () => {
    await deleteFromBucket(USER, []);

    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("throws a storage error", async () => {
    storage.remove.mockResolvedValue({ data: null, error: new Error("down") });

    await expect(deleteFromBucket(USER, [image])).rejects.toThrow("down");
  });
});

describe("getTextFromBucket", () => {
  it("reads from texts/", async () => {
    storage.download.mockResolvedValue({
      data: new Blob(["caption text"]),
      error: null,
    });

    expect(await getTextFromBucket(USER, "t1")).toBe("caption text");
    expect(storage.download).toHaveBeenCalledWith("user_01/texts/t1");
  });
});

describe("createSignedUrl", () => {
  beforeEach(() => {
    storage.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed" },
      error: null,
    });
  });

  it("signs audio for an hour", async () => {
    await createSignedUrl(USER, audio);

    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      "user_01/audios/a1",
      HOUR,
    );
  });

  it("signs an image for a week", async () => {
    await createSignedUrl(USER, image);

    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      "user_01/images/i1",
      WEEK,
    );
  });
});

describe("createSignedUrls", () => {
  it("signs each kind in its own request with its own TTL, across owners", async () => {
    storage.createSignedUrls.mockImplementation(async (paths: string[]) => ({
      data: paths.map((path) => ({ path, signedUrl: `https://${path}` })),
      error: null,
    }));

    const urls = await createSignedUrls([
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

    const urls = await createSignedUrls([{ userId: "user_01", ...image }]);

    expect(urls.size).toBe(0);
  });

  it("makes no request for an empty list", async () => {
    expect(await createSignedUrls([])).toEqual(new Map());
    expect(storage.createSignedUrls).not.toHaveBeenCalled();
  });

  it("fails if any kind's request fails", async () => {
    storage.createSignedUrls.mockImplementation(async (paths: string[]) =>
      paths[0].includes("/audios/")
        ? { data: null, error: new Error("audio signing failed") }
        : { data: [], error: null },
    );

    await expect(
      createSignedUrls([
        { userId: "user_01", ...image },
        { userId: "user_01", ...audio },
      ]),
    ).rejects.toThrow("audio signing failed");
  });
});

describe("createUploadUrl", () => {
  it.each([
    [audio, "user_01/audios/a1"],
    [image, "user_01/images/i1"],
  ])("binds the URL to the %o key", async (object, path) => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://upload" },
      error: null,
    });

    expect(await createUploadUrl(USER, object)).toBe("https://upload");
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(path);
  });
});

describe("takeUploadedObject", () => {
  const stored = (size: number, contentType: string) =>
    storage.info.mockResolvedValue({
      data: { size, contentType },
      error: null,
    });

  it("reports what storage holds and keeps it", async () => {
    stored(2048, "audio/webm");

    expect(await takeUploadedObject(USER, audio)).toEqual({
      ok: true,
      sizeBytes: 2048,
      contentType: "audio/webm",
    });
    expect(storage.info).toHaveBeenCalledWith("user_01/audios/a1");
    expect(storage.remove).not.toHaveBeenCalled();
  });

  // What storage actually returned for a missing key when checked live.
  it("reports a missing object, with nothing to delete", async () => {
    storage.info.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Object not found"), {
        status: 400,
        statusCode: "404",
      }),
    });

    expect(await takeUploadedObject(USER, audio)).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("throws any other storage error", async () => {
    storage.info.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("unauthorized"), {
        status: 400,
        statusCode: "403",
      }),
    });

    await expect(takeUploadedObject(USER, audio)).rejects.toThrow(
      "unauthorized",
    );
  });

  it("deletes audio uploaded to an image URL", async () => {
    stored(2048, "audio/webm");

    expect(await takeUploadedObject(USER, image)).toEqual({
      ok: false,
      reason: "wrong-type",
      contentType: "audio/webm",
      maxBytes: IMAGE_CAP,
    });
    expect(storage.remove).toHaveBeenCalledWith(["user_01/images/i1"]);
  });

  it.each([
    [audio, "audio/webm", MAX_AUDIO_BYTES, "user_01/audios/a1"],
    [image, "image/png", IMAGE_CAP, "user_01/images/i1"],
  ])(
    "deletes %o over its own cap and reports the cap",
    async (object, contentType, cap, path) => {
      stored(cap + 1, contentType);

      expect(await takeUploadedObject(USER, object)).toEqual({
        ok: false,
        reason: "too-large",
        contentType,
        maxBytes: cap,
      });
      expect(storage.remove).toHaveBeenCalledWith([path]);
    },
  );

  it.each([
    [audio, "audio/webm", MAX_AUDIO_BYTES],
    [image, "image/png", IMAGE_CAP],
  ])("keeps %o exactly at its cap", async (object, contentType, cap) => {
    stored(cap, contentType);

    expect(await takeUploadedObject(USER, object)).toMatchObject({ ok: true });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  // A rejection that can't clean up must not look like a handled one.
  it("throws when deleting a rejected object fails", async () => {
    stored(64, "application/zip");
    storage.remove.mockResolvedValue({
      data: null,
      error: new Error("remove failed"),
    });

    await expect(takeUploadedObject(USER, audio)).rejects.toThrow(
      "remove failed",
    );
  });
});
