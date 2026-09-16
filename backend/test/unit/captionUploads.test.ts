import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindTerminalCaptionUpload,
  mockClearCaptionUploadId,
  mockDeleteCaptionFromBucket,
} = vi.hoisted(() => ({
  mockFindTerminalCaptionUpload: vi.fn(),
  mockClearCaptionUploadId: vi.fn(),
  mockDeleteCaptionFromBucket: vi.fn(),
}));

vi.mock("../../shared/data/jobs.data", () => ({
  findTerminalCaptionUpload: mockFindTerminalCaptionUpload,
  clearCaptionUploadId: mockClearCaptionUploadId,
}));

vi.mock("../../shared/bucket", () => ({
  deleteCaptionFromBucket: mockDeleteCaptionFromBucket,
}));

import { cleanupTerminalCaptionUpload } from "../../shared/captionUploads";

const audioUploadId = "550e8400-e29b-41d4-a716-446655440000";
const captionUploadId = "650e8400-e29b-41d4-a716-446655440111";

describe("cleanupTerminalCaptionUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDeleteCaptionFromBucket.mockResolvedValue(undefined);
    mockClearCaptionUploadId.mockResolvedValue(undefined);
  });

  it("does nothing when the job has no terminal caption upload", async () => {
    mockFindTerminalCaptionUpload.mockResolvedValue(null);

    await expect(
      cleanupTerminalCaptionUpload(audioUploadId, "user_01"),
    ).resolves.toBe(false);

    expect(mockFindTerminalCaptionUpload).toHaveBeenCalledWith(
      audioUploadId,
      "user_01",
    );
    expect(mockDeleteCaptionFromBucket).not.toHaveBeenCalled();
    expect(mockClearCaptionUploadId).not.toHaveBeenCalled();
  });

  it("deletes the caption object before clearing its persisted id", async () => {
    mockFindTerminalCaptionUpload.mockResolvedValue({
      audioUploadId,
      captionUploadId,
      userId: "user_01",
    });

    await expect(cleanupTerminalCaptionUpload(audioUploadId)).resolves.toBe(
      true,
    );

    expect(mockDeleteCaptionFromBucket).toHaveBeenCalledWith(
      "user_01",
      captionUploadId,
    );
    expect(mockClearCaptionUploadId).toHaveBeenCalledWith(
      audioUploadId,
      captionUploadId,
    );
    expect(
      mockDeleteCaptionFromBucket.mock.invocationCallOrder[0],
    ).toBeLessThan(mockClearCaptionUploadId.mock.invocationCallOrder[0]);
  });

  it("keeps the persisted id when storage deletion fails", async () => {
    mockFindTerminalCaptionUpload.mockResolvedValue({
      audioUploadId,
      captionUploadId,
      userId: "user_01",
    });
    mockDeleteCaptionFromBucket.mockRejectedValue(new Error("storage failed"));

    await expect(cleanupTerminalCaptionUpload(audioUploadId)).rejects.toThrow(
      "storage failed",
    );

    expect(mockClearCaptionUploadId).not.toHaveBeenCalled();
  });
});
