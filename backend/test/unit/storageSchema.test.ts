import { describe, expect, it } from "vitest";
import { BUCKET_SETTINGS, MAX_AUDIO_BYTES } from "../../shared/storage/schema";

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
