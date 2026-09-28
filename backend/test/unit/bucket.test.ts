import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = vi.hoisted(() => ({
  createSignedUploadUrl: vi.fn(),
  info: vi.fn(),
  remove: vi.fn(),
  download: vi.fn(),
}));

const buckets = vi.hoisted(() => ({
  getBucket: vi.fn(),
  createBucket: vi.fn(),
  updateBucket: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => storage, ...buckets } }),
}));

import { bucket, MAX_AUDIO_BYTES } from "../../shared/storage/bucket";
import { BUCKET, BUCKET_SETTINGS } from "../../shared/storage/schema";

const USER = "user_01";
const IMAGE_CAP = 10 * 1024 * 1024;
const HOUR = 60 * 60;

const audio = { kind: "audio", uploadId: "a1" } as const;
const image = { kind: "image", uploadId: "i1" } as const;

beforeEach(() => {
  vi.clearAllMocks();
  storage.remove.mockResolvedValue({ data: [], error: null });
});

// Every key is <userId>/<folder>/<id>. youtube-fetcher/app/bucket.py builds the
// same keys for audio and text, and the worker reads them back from here.
describe("delete", () => {
  it("removes a mix of kinds in one request", async () => {
    await bucket.delete(USER, [audio, { kind: "text", uploadId: "t1" }, image]);

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([
      "user_01/audios/a1",
      "user_01/texts/t1",
      "user_01/images/i1",
    ]);
  });

  it("makes no request for an empty list", async () => {
    await bucket.delete(USER, []);

    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("throws a storage error", async () => {
    storage.remove.mockResolvedValue({ data: null, error: new Error("down") });

    await expect(bucket.delete(USER, [image])).rejects.toThrow("down");
  });
});

/** A token shaped like the one Supabase puts in an upload URL. */
function uploadToken(claims: object) {
  const part = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${part({ alg: "HS256" })}.${part(claims)}.signature`;
}

describe("createUploadUrl", () => {
  it.each([
    [audio, "user_01/audios/a1"],
    [image, "user_01/images/i1"],
  ])("binds the URL to the %o key", async (object, path) => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://upload", token: uploadToken({}) },
      error: null,
    });

    expect(await bucket.createUploadUrl(USER, object)).toBe("https://upload");
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(path);
  });
});

describe("verifyUploadUrlLifetime", () => {
  const mintedFor = (seconds: number) =>
    storage.createSignedUploadUrl.mockResolvedValue({
      data: {
        signedUrl: "https://upload",
        token: uploadToken({ iat: 1_000, exp: 1_000 + seconds }),
      },
      error: null,
    });

  it("passes when the URL doesn't outlive the window", async () => {
    mintedFor(2 * HOUR);

    await expect(bucket.verifyUploadUrlLifetime(2 * HOUR * 1000)).resolves.toBe(
      undefined,
    );
    // Probes a key of its own, and creates no object.
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(
      expect.stringMatching(/^preflight\/images\/[0-9a-f-]{36}$/),
    );
  });

  it("fails when the URL outlives the window", async () => {
    mintedFor(4 * HOUR);

    await expect(
      bucket.verifyUploadUrlLifetime(2 * HOUR * 1000),
    ).rejects.toThrow("Upload URLs are valid for 14400000 ms");
  });

  // Without it, nothing could tell whether the window still covers the URL,
  // so this refuses rather than guessing.
  it("fails when the token carries no lifetime", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://upload", token: uploadToken({ sub: "x" }) },
      error: null,
    });

    await expect(
      bucket.verifyUploadUrlLifetime(2 * HOUR * 1000),
    ).rejects.toThrow("Upload token carries no lifetime");
  });

  it("fails when storage won't mint one", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: null,
      error: new Error("storage down"),
    });

    await expect(
      bucket.verifyUploadUrlLifetime(2 * HOUR * 1000),
    ).rejects.toThrow("storage down");
  });
});

describe("inspectUploadedObject", () => {
  const stored = (size: number, contentType: string) =>
    storage.info.mockResolvedValue({
      data: { size, contentType },
      error: null,
    });

  it("reports what storage holds", async () => {
    stored(2048, "audio/webm");

    expect(await bucket.inspectUploadedObject(USER, audio)).toEqual({
      ok: true,
      sizeBytes: 2048,
      contentType: "audio/webm",
    });
    expect(storage.info).toHaveBeenCalledWith("user_01/audios/a1");
  });

  // What storage actually returned for a missing key when checked live.
  it("reports a missing object", async () => {
    storage.info.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("Object not found"), {
        status: 400,
        statusCode: "404",
      }),
    });

    expect(await bucket.inspectUploadedObject(USER, audio)).toEqual({
      ok: false,
      reason: "missing",
    });
  });

  it("throws any other storage error", async () => {
    storage.info.mockResolvedValue({
      data: null,
      error: Object.assign(new Error("unauthorized"), {
        status: 400,
        statusCode: "403",
      }),
    });

    await expect(bucket.inspectUploadedObject(USER, audio)).rejects.toThrow(
      "unauthorized",
    );
  });

  it("rejects audio in an image upload, without deleting it", async () => {
    stored(2048, "audio/webm");

    expect(await bucket.inspectUploadedObject(USER, image)).toEqual({
      ok: false,
      reason: "wrong-type",
      contentType: "audio/webm",
      maxBytes: IMAGE_CAP,
    });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it.each([
    [audio, "audio/webm", MAX_AUDIO_BYTES],
    [image, "image/png", IMAGE_CAP],
  ])(
    "rejects %o over its own cap and reports the cap",
    async (object, contentType, cap) => {
      stored(cap + 1, contentType);

      expect(await bucket.inspectUploadedObject(USER, object)).toEqual({
        ok: false,
        reason: "too-large",
        contentType,
        maxBytes: cap,
      });
      expect(storage.remove).not.toHaveBeenCalled();
    },
  );

  it.each([
    [audio, "audio/webm", MAX_AUDIO_BYTES],
    [image, "image/png", IMAGE_CAP],
  ])("accepts %o exactly at its cap", async (object, contentType, cap) => {
    stored(cap, contentType);

    expect(await bucket.inspectUploadedObject(USER, object)).toMatchObject({
      ok: true,
    });
  });
});

describe("bucket settings", () => {
  it("reads the live settings, with an unenforced limit as null", async () => {
    buckets.getBucket.mockResolvedValue({
      data: { public: false, file_size_limit: 1024 },
      error: null,
    });

    expect(await bucket.readSettings(BUCKET)).toEqual({
      public: false,
      fileSizeLimit: 1024,
      allowedMimeTypes: null,
    });
    expect(buckets.getBucket).toHaveBeenCalledWith(BUCKET);
  });

  it("reads a missing bucket as null", async () => {
    buckets.getBucket.mockResolvedValue({
      data: null,
      error: { status: 400, statusCode: "404", message: "Bucket not found" },
    });

    expect(await bucket.readSettings(BUCKET)).toBeNull();
  });

  it("throws any other read failure", async () => {
    buckets.getBucket.mockResolvedValue({
      data: null,
      error: new Error("unreachable"),
    });

    await expect(bucket.readSettings(BUCKET)).rejects.toThrow("unreachable");
  });

  it("creates and updates the bucket with the settings given", async () => {
    buckets.createBucket.mockResolvedValue({ data: {}, error: null });
    buckets.updateBucket.mockResolvedValue({ data: {}, error: null });

    await bucket.create(BUCKET, BUCKET_SETTINGS);
    await bucket.updateSettings(BUCKET, BUCKET_SETTINGS);

    expect(buckets.createBucket).toHaveBeenCalledWith(BUCKET, BUCKET_SETTINGS);
    expect(buckets.updateBucket).toHaveBeenCalledWith(BUCKET, BUCKET_SETTINGS);
  });

  it("throws when Supabase refuses a change", async () => {
    buckets.updateBucket.mockResolvedValue({
      data: null,
      error: new Error("forbidden"),
    });

    await expect(
      bucket.updateSettings(BUCKET, BUCKET_SETTINGS),
    ).rejects.toThrow("forbidden");
  });
});

describe("verifySettings", () => {
  const live = (settings: object) =>
    buckets.getBucket.mockResolvedValue({ data: settings, error: null });

  it("passes when the live bucket is what the schema declares", async () => {
    live({
      public: false,
      file_size_limit: BUCKET_SETTINGS.fileSizeLimit,
      allowed_mime_types: [...BUCKET_SETTINGS.allowedMimeTypes].reverse(),
    });

    await expect(bucket.verifySettings()).resolves.toBeUndefined();
  });

  it("fails when a limit was loosened, and says how to fix it", async () => {
    live({
      public: false,
      allowed_mime_types: BUCKET_SETTINGS.allowedMimeTypes,
    });

    await expect(bucket.verifySettings()).rejects.toThrow(
      /not the storage schema's .*; run npm run storage:push/,
    );
  });

  it("fails when there is no bucket", async () => {
    buckets.getBucket.mockResolvedValue({
      data: null,
      error: { status: 400, statusCode: "404", message: "Bucket not found" },
    });

    await expect(bucket.verifySettings()).rejects.toThrow("does not exist");
  });
});
