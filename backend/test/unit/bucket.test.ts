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
  MAX_IMAGE_BYTES,
  createAudioUploadUrl,
  createImageUploadUrl,
  createSignedAudioUrl,
  createSignedImageUrl,
  createSignedImageUrls,
  deleteAudioJobFilesFromBucket,
  deleteTextFromBucket,
  deleteImagesFromBucket,
  getTextFromBucket,
  takeUploadedAudio,
  takeUploadedImage,
} from "../../shared/bucket";

const USER = "user_01";
// The single-object functions take a typed UploadId, which is uuid-shaped.
const AUDIO_ID = "11111111-1111-4111-8111-111111111111";
const TEXT_ID = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID = "33333333-3333-4333-8333-333333333333";

// Every key is <userId>/<kind>/<id>. youtube-fetcher/app/bucket.py builds the
// same keys for audio and text, and the worker reads them back from here.
describe("bucket key layout", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    storage.remove.mockResolvedValue({ data: [], error: null });
    storage.createSignedUrl.mockResolvedValue({
      data: { signedUrl: "https://signed" },
      error: null,
    });
  });

  it("deletes images under images/", async () => {
    await deleteImagesFromBucket(USER, ["i1", "i2"]);

    expect(storage.remove).toHaveBeenCalledWith([
      "user_01/images/i1",
      "user_01/images/i2",
    ]);
  });

  it("makes no call for an empty image list", async () => {
    await deleteImagesFromBucket(USER, []);

    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("deletes a job's audio and caption text in one call", async () => {
    await deleteAudioJobFilesFromBucket(USER, "a1", "c1");

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([
      "user_01/audios/a1",
      "user_01/texts/c1",
    ]);
  });

  it("deletes only the audio of a job without captions", async () => {
    await deleteAudioJobFilesFromBucket(USER, "a1", null);

    expect(storage.remove).toHaveBeenCalledWith(["user_01/audios/a1"]);
  });

  it("deletes text under texts/", async () => {
    await deleteTextFromBucket(USER, "c1");

    expect(storage.remove).toHaveBeenCalledWith(["user_01/texts/c1"]);
  });

  it("reads text from texts/", async () => {
    storage.download.mockResolvedValue({
      data: new Blob(["caption text"]),
      error: null,
    });

    expect(await getTextFromBucket(USER, TEXT_ID)).toBe("caption text");
    expect(storage.download).toHaveBeenCalledWith(`user_01/texts/${TEXT_ID}`);
  });

  it("signs audio under audios/ for an hour", async () => {
    await createSignedAudioUrl(USER, AUDIO_ID);

    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      `user_01/audios/${AUDIO_ID}`,
      60 * 60,
    );
  });

  it("signs an image under images/ for a week", async () => {
    await createSignedImageUrl(USER, IMAGE_ID);

    expect(storage.createSignedUrl).toHaveBeenCalledWith(
      `user_01/images/${IMAGE_ID}`,
      7 * 24 * 60 * 60,
    );
  });

  it("maps signed image urls back to ids across owners", async () => {
    storage.createSignedUrls.mockResolvedValue({
      data: [
        { path: "user_01/images/i1", signedUrl: "https://one" },
        { path: "user_02/images/i2", signedUrl: "https://two" },
      ],
      error: null,
    });

    const urls = await createSignedImageUrls([
      { userId: "user_01", storageObjectId: "i1" },
      { userId: "user_02", storageObjectId: "i2" },
    ]);

    expect(storage.createSignedUrls).toHaveBeenCalledWith(
      ["user_01/images/i1", "user_02/images/i2"],
      7 * 24 * 60 * 60,
    );
    expect(urls).toEqual(
      new Map([
        ["i1", "https://one"],
        ["i2", "https://two"],
      ]),
    );
  });
});

describe("audio uploads", () => {
  const PATH = `user_01/audios/${AUDIO_ID}`;
  const stored = (size: number, contentType: string) =>
    storage.info.mockResolvedValue({
      data: { size, contentType },
      error: null,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    storage.remove.mockResolvedValue({ data: [], error: null });
  });

  it("mints an upload URL bound to the audio key", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://upload" },
      error: null,
    });

    expect(await createAudioUploadUrl(USER, AUDIO_ID)).toBe("https://upload");
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(PATH);
  });

  it("reports what storage holds and keeps it", async () => {
    stored(2048, "audio/webm");

    expect(await takeUploadedAudio(USER, AUDIO_ID)).toEqual({
      ok: true,
      sizeBytes: 2048,
      contentType: "audio/webm",
    });
    expect(storage.info).toHaveBeenCalledWith(PATH);
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

    expect(await takeUploadedAudio(USER, AUDIO_ID)).toEqual({
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

    await expect(takeUploadedAudio(USER, AUDIO_ID)).rejects.toThrow(
      "unauthorized",
    );
  });

  it("deletes an object that is not audio", async () => {
    stored(64, "application/zip");

    expect(await takeUploadedAudio(USER, AUDIO_ID)).toEqual({
      ok: false,
      reason: "wrong-type",
      contentType: "application/zip",
    });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("deletes an object over the cap", async () => {
    stored(MAX_AUDIO_BYTES + 1, "audio/webm");

    expect(await takeUploadedAudio(USER, AUDIO_ID)).toMatchObject({
      ok: false,
      reason: "too-large",
    });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });

  it("keeps an object exactly at the cap", async () => {
    stored(MAX_AUDIO_BYTES, "audio/webm");

    expect(await takeUploadedAudio(USER, AUDIO_ID)).toMatchObject({ ok: true });
    expect(storage.remove).not.toHaveBeenCalled();
  });

  // A rejection that can't clean up must not look like a handled one.
  it("throws when deleting a rejected object fails", async () => {
    stored(64, "application/zip");
    storage.remove.mockResolvedValue({
      data: null,
      error: new Error("remove failed"),
    });

    await expect(takeUploadedAudio(USER, AUDIO_ID)).rejects.toThrow(
      "remove failed",
    );
  });
});

describe("image uploads", () => {
  const PATH = `user_01/images/${IMAGE_ID}`;
  const stored = (size: number, contentType: string) =>
    storage.info.mockResolvedValue({
      data: { size, contentType },
      error: null,
    });

  beforeEach(() => {
    vi.clearAllMocks();
    storage.remove.mockResolvedValue({ data: [], error: null });
  });

  it("mints an upload URL bound to the image key", async () => {
    storage.createSignedUploadUrl.mockResolvedValue({
      data: { signedUrl: "https://upload" },
      error: null,
    });

    expect(await createImageUploadUrl(USER, IMAGE_ID)).toBe("https://upload");
    expect(storage.createSignedUploadUrl).toHaveBeenCalledWith(PATH);
  });

  it("reads the image back from images/ and keeps it", async () => {
    stored(4096, "image/png");

    expect(await takeUploadedImage(USER, IMAGE_ID)).toEqual({
      ok: true,
      sizeBytes: 4096,
      contentType: "image/png",
    });
    expect(storage.info).toHaveBeenCalledWith(PATH);
    expect(storage.remove).not.toHaveBeenCalled();
  });

  it("deletes audio uploaded to an image URL", async () => {
    stored(4096, "audio/webm");

    expect(await takeUploadedImage(USER, IMAGE_ID)).toMatchObject({
      ok: false,
      reason: "wrong-type",
    });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });

  // The image cap, not the audio one, which is ten times larger.
  it("deletes an image over the image cap", async () => {
    stored(MAX_IMAGE_BYTES + 1, "image/png");

    expect(await takeUploadedImage(USER, IMAGE_ID)).toMatchObject({
      ok: false,
      reason: "too-large",
    });
    expect(storage.remove).toHaveBeenCalledWith([PATH]);
  });
});
