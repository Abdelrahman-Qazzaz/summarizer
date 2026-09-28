import { describe, expect, it } from "vitest";
import {
  AUDIO_BUCKET,
  BUCKET_SETTINGS,
  MAX_AUDIO_BYTES,
  matchesBucketSettings,
} from "../../shared/storage/schema";

const SETTINGS = BUCKET_SETTINGS[AUDIO_BUCKET];

describe("BUCKET_SETTINGS", () => {
  it("declares every bucket KINDS stores objects in", () => {
    expect(Object.keys(BUCKET_SETTINGS)).toEqual([AUDIO_BUCKET]);
  });

  it("caps every upload at the largest kind's limit", () => {
    expect(SETTINGS.fileSizeLimit).toBe(MAX_AUDIO_BYTES);
  });

  it("accepts only the content types of the kinds clients upload", () => {
    expect(SETTINGS.allowedMimeTypes).toEqual(["image/*", "audio/*"]);
  });

  it("keeps the bucket private: every read goes through a signed URL", () => {
    expect(SETTINGS.public).toBe(false);
  });
});

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
