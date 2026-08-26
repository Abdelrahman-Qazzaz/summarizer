import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDeleteFilesFromBucket,
  mockDeleteOwnedUnattachedImageUpload,
  mockFindOwnedUnattachedImageUploadId,
} = vi.hoisted(() => ({
  mockDeleteFilesFromBucket: vi.fn(),
  mockDeleteOwnedUnattachedImageUpload: vi.fn(),
  mockFindOwnedUnattachedImageUploadId: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: {},
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/bucket", async (importActual) => ({
  ...(await importActual<typeof import("../../shared/bucket")>()),
  deleteFilesFromBucket: mockDeleteFilesFromBucket,
}));

vi.mock("../../api/src/data/images.data", async (importActual) => ({
  ...(await importActual<typeof import("../../api/src/data/images.data")>()),
  deleteOwnedUnattachedImageUpload: mockDeleteOwnedUnattachedImageUpload,
  findOwnedUnattachedImageUploadId: mockFindOwnedUnattachedImageUploadId,
}));

import { createApp } from "../../api/app";
import { authedHeaders } from "../helpers/session";

const uploadId = "550e8400-e29b-41d4-a716-446655440000";

async function deleteImage(userId = "user_01OWNER") {
  return (await createApp()).request(
    `http://localhost/upload/image/${uploadId}`,
    {
      method: "DELETE",
      headers: await authedHeaders(userId),
    },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockDeleteFilesFromBucket.mockResolvedValue(undefined);
  mockDeleteOwnedUnattachedImageUpload.mockResolvedValue(undefined);
  mockFindOwnedUnattachedImageUploadId.mockResolvedValue(null);
});

describe("DELETE /upload/image/:uploadId", () => {
  it("deletes an owned, unattached image", async () => {
    mockFindOwnedUnattachedImageUploadId.mockResolvedValueOnce(uploadId);

    const response = await deleteImage();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Image deleted" });
    expect(mockFindOwnedUnattachedImageUploadId).toHaveBeenCalledWith(
      "user_01OWNER",
      uploadId,
    );
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith("user_01OWNER", [
      uploadId,
    ]);
    expect(mockDeleteOwnedUnattachedImageUpload).toHaveBeenCalledWith(
      "user_01OWNER",
      uploadId,
    );
    expect(mockDeleteFilesFromBucket.mock.invocationCallOrder[0]).toBeLessThan(
      mockDeleteOwnedUnattachedImageUpload.mock.invocationCallOrder[0],
    );
  });

  it("does not touch storage for an attached image", async () => {
    const response = await deleteImage();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ message: "Image deleted" });
    expect(mockDeleteFilesFromBucket).not.toHaveBeenCalled();
    expect(mockDeleteOwnedUnattachedImageUpload).not.toHaveBeenCalled();
  });

  it("rejects an invalid upload id", async () => {
    const response = await (
      await createApp()
    ).request("http://localhost/upload/image/not-a-uuid", {
      method: "DELETE",
      headers: await authedHeaders("user_01OWNER"),
    });

    expect(response.status).toBe(400);
    expect(mockFindOwnedUnattachedImageUploadId).not.toHaveBeenCalled();
  });

  it("requires authentication", async () => {
    const response = await (
      await createApp()
    ).request(`http://localhost/upload/image/${uploadId}`, {
      method: "DELETE",
      headers: { Origin: process.env.CLIENT_URL! },
    });

    expect(response.status).toBe(401);
    expect(mockFindOwnedUnattachedImageUploadId).not.toHaveBeenCalled();
  });

  it("keeps the database row retryable when storage deletion fails", async () => {
    mockFindOwnedUnattachedImageUploadId.mockResolvedValueOnce(uploadId);
    mockDeleteFilesFromBucket.mockRejectedValueOnce(
      new Error("storage unavailable"),
    );

    const response = await deleteImage();

    expect(response.status).toBe(500);
    expect(mockDeleteOwnedUnattachedImageUpload).not.toHaveBeenCalled();
  });
});
