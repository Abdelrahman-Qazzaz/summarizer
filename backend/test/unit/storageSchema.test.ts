import { describe, expect, it } from "vitest";
import {
  AUDIO_BUCKET,
  BUCKET_SETTINGS,
  IMAGE_BUCKET,
  KINDS,
  MAX_AUDIO_BYTES,
  matchesBucketSettings,
  type BucketSettings,
} from "../../shared/storage/schema";

describe("BUCKET_SETTINGS", () => {
  it("declares every bucket KINDS stores objects in", () => {
    expect(Object.keys(BUCKET_SETTINGS).sort()).toEqual(
      [AUDIO_BUCKET, IMAGE_BUCKET].sort(),
    );
  });

  // Each bucket holds one uploadable kind, so storage enforces that kind's
  // own limits rather than the largest kind's.
  it.each([
    [IMAGE_BUCKET, KINDS.image.upload.maxBytes, ["image/*"]],
    [AUDIO_BUCKET, MAX_AUDIO_BYTES, ["audio/*"]],
  ])("holds %s to its kind's limits", (name, maxBytes, contentTypes) => {
    expect(BUCKET_SETTINGS[name]).toMatchObject({
      fileSizeLimit: maxBytes,
      allowedMimeTypes: contentTypes,
    });
  });

  it("keeps every bucket private: every read goes through a signed URL", () => {
    for (const settings of Object.values(BUCKET_SETTINGS)) {
      expect(settings.public).toBe(false);
    }
  });
});

const SETTINGS: BucketSettings = {
  public: false,
  fileSizeLimit: 1024,
  allowedMimeTypes: ["image/*", "audio/*"],
};

describe("matchesBucketSettings", () => {
  it("matches the declared settings, whatever order the types are in", () => {
    expect(
      matchesBucketSettings(
        {
          ...SETTINGS,
          allowedMimeTypes: [...SETTINGS.allowedMimeTypes].reverse(),
        },
        SETTINGS,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "a bucket with no limits",
      { fileSizeLimit: null, allowedMimeTypes: null },
    ],
    ["a looser size limit", { fileSizeLimit: SETTINGS.fileSizeLimit * 2 }],
    [
      "an extra content type",
      { allowedMimeTypes: ["image/*", "audio/*", "video/*"] },
    ],
    ["a public bucket", { public: true }],
  ])("doesn't match %s", (_, change) => {
    expect(matchesBucketSettings({ ...SETTINGS, ...change }, SETTINGS)).toBe(
      false,
    );
  });
});
