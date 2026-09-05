import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockDelete,
  mockDeleteWhere,
  mockFrom,
  mockInsert,
  mockLimit,
  mockReturning,
  mockSelect,
  mockSelectWhere,
  mockSubqueryWhere,
  mockValues,
} = vi.hoisted(() => ({
  mockDelete: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockInsert: vi.fn(),
  mockLimit: vi.fn(),
  mockReturning: vi.fn(),
  mockSelect: vi.fn(),
  mockSelectWhere: vi.fn(),
  mockSubqueryWhere: vi.fn(),
  mockValues: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: {
    delete: mockDelete,
    insert: mockInsert,
    select: mockSelect,
  },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

import {
  createAttachmentUpload,
  deleteOwnedUnattachedAttachmentUpload,
  findOwnedUnattachedAttachmentUploadId,
} from "../../shared/data/attachments.data";
import { AttachmentUploads, ChatMessageAttachments } from "../../shared/db";

beforeEach(() => {
  vi.clearAllMocks();
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockResolvedValue(undefined);
  mockSelect.mockReturnValue({ from: mockFrom });
  mockFrom.mockImplementation((table) =>
    table === AttachmentUploads
      ? { where: mockSelectWhere }
      : { where: mockSubqueryWhere },
  );
  mockSelectWhere.mockReturnValue({ limit: mockLimit });
  mockSubqueryWhere.mockReturnValue({});
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockDeleteWhere.mockReturnValue({ returning: mockReturning });
});

describe("attachment uploads", () => {
  it("creates an attachment upload", async () => {
    const upload = {
      attachmentUploadId: "550e8400-e29b-41d4-a716-446655440000",
      kind: "image" as const,
      userId: "user-1",
      fileName: "diagram.png",
      mimeType: "image/png",
      sizeBytes: 128,
      signedUrl: "https://example.com/diagram.png",
      signedUrlExpiresAt: new Date("2026-09-06T00:00:00.000Z"),
    };

    await createAttachmentUpload(upload);

    expect(mockInsert).toHaveBeenCalledWith(AttachmentUploads);
    expect(mockValues).toHaveBeenCalledWith(upload);
  });

  it("returns null when no matching unattached upload exists", async () => {
    mockLimit.mockResolvedValueOnce([]);

    await expect(
      findOwnedUnattachedAttachmentUploadId({
        userId: "user-1",
        attachmentUploadId: "missing-upload",
        kind: "image",
      }),
    ).resolves.toBeNull();

    expect(mockFrom).toHaveBeenCalledWith(ChatMessageAttachments);
  });

  it("returns the upload deleted by the guarded delete", async () => {
    mockReturning.mockResolvedValueOnce([
      { attachmentUploadId: "image-upload-1" },
    ]);

    await expect(
      deleteOwnedUnattachedAttachmentUpload({
        userId: "user-1",
        attachmentUploadId: "image-upload-1",
        kind: "image",
      }),
    ).resolves.toBe("image-upload-1");
  });
});
