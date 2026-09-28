import { describe, expect, it } from "vitest";
import {
  BUCKET_SETTINGS,
  MAX_AUDIO_BYTES,
  matchesBucketSettings,
} from "../../shared/storage/schema";

describe("BUCKET_SETTINGS", () => {
  it("caps every upload at the largest kind's limit", () => {
    expect(BUCKET_SETTINGS.fileSizeLimit).toBe(MAX_AUDIO_BYTES);
  });

  it("accepts only the content types of the kinds clients upload", () => {
    expect(BUCKET_SETTINGS.allowedMimeTypes).toEqual(["image/*", "audio/*"]);
  });

  it("keeps the bucket private: every read goes through a signed URL", () => {
    expect(BUCKET_SETTINGS.public).toBe(false);
  });
});

describe("matchesBucketSettings", () => {
  it("matches the declared settings, whatever order the types are in", () => {
    expect(
      matchesBucketSettings(
        {
          ...BUCKET_SETTINGS,
          allowedMimeTypes: [...BUCKET_SETTINGS.allowedMimeTypes].reverse(),
        },
        BUCKET_SETTINGS,
      ),
    ).toBe(true);
  });

  it.each([
    [
      "a bucket with no limits",
      { fileSizeLimit: null, allowedMimeTypes: null },
    ],
    [
      "a looser size limit",
      { fileSizeLimit: BUCKET_SETTINGS.fileSizeLimit * 2 },
    ],
    [
      "an extra content type",
      { allowedMimeTypes: ["image/*", "audio/*", "video/*"] },
    ],
    ["a public bucket", { public: true }],
  ])("doesn't match %s", (_, change) => {
    expect(
      matchesBucketSettings({ ...BUCKET_SETTINGS, ...change }, BUCKET_SETTINGS),
    ).toBe(false);
  });
});
