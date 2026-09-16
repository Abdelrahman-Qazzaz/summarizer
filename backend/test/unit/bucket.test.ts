import { describe, it, expect, vi, beforeEach } from "vitest";

const storage = vi.hoisted(() => ({
  remove: vi.fn(),
  download: vi.fn(),
  createSignedUrl: vi.fn(),
  createSignedUrls: vi.fn(),
}));

vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({ storage: { from: () => storage } }),
}));

import {
  createSignedAudioUrl,
  createSignedImageUrl,
  createSignedImageUrls,
  deleteAudioJobFilesFromBucket,
  deleteCaptionFromBucket,
  deleteImagesFromBucket,
  getCaptionText,
} from "../../shared/bucket";

const USER = "user_01";
// The single-object functions take a typed UploadId, which is uuid-shaped.
const AUDIO_ID = "11111111-1111-4111-8111-111111111111";
const CAPTION_ID = "22222222-2222-4222-8222-222222222222";
const IMAGE_ID = "33333333-3333-4333-8333-333333333333";

// Every key is <userId>/<kind>/<id>. youtube-fetcher/app/bucket.py builds the
// same keys for audio and captions, and the worker reads them back from here.
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

  it("deletes a job's audio and caption in one call", async () => {
    await deleteAudioJobFilesFromBucket(USER, "a1", "c1");

    expect(storage.remove).toHaveBeenCalledTimes(1);
    expect(storage.remove).toHaveBeenCalledWith([
      "user_01/audios/a1",
      "user_01/captions/c1",
    ]);
  });

  it("deletes only the audio of a job without captions", async () => {
    await deleteAudioJobFilesFromBucket(USER, "a1", null);

    expect(storage.remove).toHaveBeenCalledWith(["user_01/audios/a1"]);
  });

  it("deletes a caption under captions/", async () => {
    await deleteCaptionFromBucket(USER, "c1");

    expect(storage.remove).toHaveBeenCalledWith(["user_01/captions/c1"]);
  });

  it("reads a caption from captions/", async () => {
    storage.download.mockResolvedValue({
      data: new Blob(["caption text"]),
      error: null,
    });

    expect(await getCaptionText(USER, CAPTION_ID)).toBe("caption text");
    expect(storage.download).toHaveBeenCalledWith(
      `user_01/captions/${CAPTION_ID}`,
    );
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
