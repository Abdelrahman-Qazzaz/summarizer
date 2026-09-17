import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockFindTerminalCaptionUpload,
  mockClearCaptionUploadId,
  mockReleaseObjects,
} = vi.hoisted(() => ({
  mockFindTerminalCaptionUpload: vi.fn(),
  mockClearCaptionUploadId: vi.fn(),
  mockReleaseObjects: vi.fn(),
}));

vi.mock("../../shared/data/jobs.data", () => ({
  findTerminalCaptionUpload: mockFindTerminalCaptionUpload,
  clearCaptionUploadId: mockClearCaptionUploadId,
}));

vi.mock("../../shared/uploads", () => ({
  releaseObjects: mockReleaseObjects,
}));

import { cleanupTerminalCaptionUpload } from "../../shared/captionUploads";

const audioUploadId = "550e8400-e29b-41d4-a716-446655440000";
const captionUploadId = "650e8400-e29b-41d4-a716-446655440111";
const terminalUpload = { audioUploadId, captionUploadId, userId: "user_01" };

describe("cleanupTerminalCaptionUpload", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockReleaseObjects.mockResolvedValue(undefined);
    mockClearCaptionUploadId.mockResolvedValue(true);
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
    expect(mockReleaseObjects).not.toHaveBeenCalled();
    expect(mockClearCaptionUploadId).not.toHaveBeenCalled();
  });

  // Clearing the id is what marks the text deleted, so it comes first: a
  // storage failure after it is the sweep's to finish.
  it("clears the caption id, then releases the text", async () => {
    mockFindTerminalCaptionUpload.mockResolvedValue(terminalUpload);

    await expect(cleanupTerminalCaptionUpload(audioUploadId)).resolves.toBe(
      true,
    );

    expect(mockClearCaptionUploadId).toHaveBeenCalledWith(
      audioUploadId,
      captionUploadId,
      "user_01",
    );
    expect(mockReleaseObjects).toHaveBeenCalledWith("user_01", [
      { kind: "text", uploadId: captionUploadId },
    ]);
    expect(mockClearCaptionUploadId.mock.invocationCallOrder[0]).toBeLessThan(
      mockReleaseObjects.mock.invocationCallOrder[0],
    );
  });

  it("releases nothing when another cleanup already cleared the id", async () => {
    mockFindTerminalCaptionUpload.mockResolvedValue(terminalUpload);
    mockClearCaptionUploadId.mockResolvedValue(false);

    await expect(cleanupTerminalCaptionUpload(audioUploadId)).resolves.toBe(
      false,
    );
    expect(mockReleaseObjects).not.toHaveBeenCalled();
  });

  it("reports a storage failure", async () => {
    mockFindTerminalCaptionUpload.mockResolvedValue(terminalUpload);
    mockReleaseObjects.mockRejectedValue(new Error("storage failed"));

    await expect(cleanupTerminalCaptionUpload(audioUploadId)).rejects.toThrow(
      "storage failed",
    );
  });
});
