import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDeleteOwnedUnlinkedUnreservedImageAttachment,
  mockInsert,
  mockValues,
  mockCreateImageUploadUrl,
  mockTakeUploadedImage,
  mockCreateSignedImageUrl,
} = vi.hoisted(() => ({
  mockDeleteOwnedUnlinkedUnreservedImageAttachment: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockCreateImageUploadUrl: vi.fn(),
  mockTakeUploadedImage: vi.fn(),
  mockCreateSignedImageUrl: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: { insert: mockInsert },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/bucket", () => ({
  createImageUploadUrl: mockCreateImageUploadUrl,
  takeUploadedImage: mockTakeUploadedImage,
  createSignedImageUrl: mockCreateSignedImageUrl,
  createSignedImageUrls: vi.fn(),
  deleteImagesFromBucket: vi.fn(),
  // Literals: vi.mock factories run before this module's own bindings exist.
  BUCKET: "Audio & Text files",
  MAX_AUDIO_BYTES: 100 * 1024 * 1024,
  MAX_IMAGE_BYTES: 10 * 1024 * 1024,
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

vi.mock("../../shared/data/images.data", async (importActual) => ({
  ...(await importActual<typeof import("../../shared/data/images.data")>()),
  deleteOwnedUnlinkedUnreservedImageAttachment:
    mockDeleteOwnedUnlinkedUnreservedImageAttachment,
}));

import { createApp } from "../../api/app";
import { authedHeaders, sessionCookieHeader } from "../helpers/session";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

const imageUploadId = "550e8400-e29b-41d4-a716-446655440000";

async function deleteImage(userId = "user_01OWNER") {
  return (await createApp()).request(
    `http://localhost/upload/image/${imageUploadId}`,
    {
      method: "DELETE",
      headers: await authedHeaders(userId),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteOwnedUnlinkedUnreservedImageAttachment.mockResolvedValue(undefined);
});

describe("DELETE /upload/image/:imageUploadId", () => {
  it("deletes an owned, unlinked, unreserved image attachment", async () => {
    const response = await deleteImage();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Image deleted" });
    expect(
      mockDeleteOwnedUnlinkedUnreservedImageAttachment,
    ).toHaveBeenCalledWith("user_01OWNER", imageUploadId);
  });

  it("rejects an invalid upload id", async () => {
    const response = await (
      await createApp()
    ).request("http://localhost/upload/image/not-a-uuid", {
      method: "DELETE",
      headers: await authedHeaders("user_01OWNER"),
    });

    expect(response.status).toBe(400);
    expect(
      mockDeleteOwnedUnlinkedUnreservedImageAttachment,
    ).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const response = await (
      await createApp()
    ).request(`http://localhost/upload/image/${imageUploadId}`, {
      method: "DELETE",
      headers: { Origin: process.env.CLIENT_URL! },
    });

    expect(response.status).toBe(401);
    expect(
      mockDeleteOwnedUnlinkedUnreservedImageAttachment,
    ).not.toHaveBeenCalled();
  });

  it("reports deletion failures", async () => {
    mockDeleteOwnedUnlinkedUnreservedImageAttachment.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    const response = await deleteImage();

    expect(response.status).toBe(500);
  });
});

async function postJson(path: string, body: unknown) {
  return (await createApp()).request(`http://localhost${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Cookie: await sessionCookieHeader("user_01"),
    },
    body: JSON.stringify(body),
  });
}

describe("POST /upload/image", () => {
  beforeEach(() => {
    mockCreateImageUploadUrl.mockResolvedValue("https://storage.test/upload");
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });

    expect(res.status).toBe(401);
    expect(mockCreateImageUploadUrl).not.toHaveBeenCalled();
  });

  it("mints a fresh id and a URL bound to it, writing no row", async () => {
    const res = await postJson("/upload/image", {});

    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      uploadId: string;
      signedUploadUrl: string;
    };
    expect(body.uploadId).toMatch(/^[0-9a-f-]{36}$/);
    expect(body.signedUploadUrl).toBe("https://storage.test/upload");
    expect(mockCreateImageUploadUrl).toHaveBeenCalledWith(
      "user_01",
      body.uploadId,
    );
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("POST /upload/image/confirm", () => {
  const confirmBody = { uploadId: imageUploadId, fileName: "shot.png" };

  beforeEach(() => {
    mockValues.mockResolvedValue(undefined);
    mockInsert.mockReturnValue({ values: mockValues });
    mockCreateSignedImageUrl.mockResolvedValue("https://storage.test/read");
    mockTakeUploadedImage.mockResolvedValue({
      ok: true,
      sizeBytes: 4096,
      contentType: "image/png",
    });
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/upload/image/confirm", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(confirmBody),
    });

    expect(res.status).toBe(401);
    expect(mockTakeUploadedImage).not.toHaveBeenCalled();
  });

  it("returns 400 for an id that is not a uuid", async () => {
    const res = await postJson("/upload/image/confirm", {
      ...confirmBody,
      uploadId: "not-a-uuid",
    });

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "Invalid upload id" });
    expect(mockTakeUploadedImage).not.toHaveBeenCalled();
  });

  // Also what an id minted for audio gets: its object is under audios/.
  it("returns 404 when no image was uploaded under the id", async () => {
    mockTakeUploadedImage.mockResolvedValue({ ok: false, reason: "missing" });

    const res = await postJson("/upload/image/confirm", confirmBody);

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      message: "No uploaded image to confirm",
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 400 when storage holds something other than an image", async () => {
    mockTakeUploadedImage.mockResolvedValue({
      ok: false,
      reason: "wrong-type",
      contentType: "audio/webm",
    });

    const res = await postJson("/upload/image/confirm", confirmBody);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ message: "File must be an image" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("returns 413 when the stored image is over the cap", async () => {
    mockTakeUploadedImage.mockResolvedValue({
      ok: false,
      reason: "too-large",
      contentType: "image/png",
    });

    const res = await postJson("/upload/image/confirm", confirmBody);

    expect(res.status).toBe(413);
    expect(await res.json()).toEqual({
      message: "Image is too large",
      maxBytes: MAX_IMAGE_BYTES,
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("records the stored size and type with the signed URL it returns", async () => {
    const res = await postJson("/upload/image/confirm", confirmBody);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      message: "File uploaded",
      imageUploadId,
      fileName: "shot.png",
      size: 4096,
      mimeType: "image/png",
      mode: "image",
      signedUrl: "https://storage.test/read",
    });
    expect(mockTakeUploadedImage).toHaveBeenCalledWith(
      "user_01",
      imageUploadId,
    );
    expect(mockValues).toHaveBeenCalledWith(
      expect.objectContaining({
        attachmentId: imageUploadId,
        kind: "image",
        userId: "user_01",
        fileName: "shot.png",
        mimeType: "image/png",
        sizeBytes: 4096,
        signedUrl: "https://storage.test/read",
        signedUrlExpiresAt: expect.any(Date),
      }),
    );
  });

  it("returns 409 on a repeat confirm", async () => {
    mockValues.mockRejectedValueOnce(
      new Error("Failed query", {
        cause: Object.assign(new Error("duplicate key value"), {
          code: "23505",
        }),
      }),
    );

    const res = await postJson("/upload/image/confirm", confirmBody);

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: "This upload was already confirmed",
    });
  });

  it("still fails loudly on any other database error", async () => {
    mockValues.mockRejectedValueOnce(new Error("connection reset"));

    const res = await postJson("/upload/image/confirm", confirmBody);

    expect(res.status).toBe(500);
  });
});
