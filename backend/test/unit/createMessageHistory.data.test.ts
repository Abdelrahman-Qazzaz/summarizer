import { beforeEach, describe, expect, it, vi } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";

const { mockExecute, mockResolveImageUploadUrls } = vi.hoisted(() => ({
  mockExecute: vi.fn(),
  mockResolveImageUploadUrls: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: { execute: mockExecute },
  ...(await import("../../shared/db/schema")),
}));

vi.mock("../../api/src/data/images.data", () => ({
  deleteOrphanedImageUploads: vi.fn(),
  resolveImageUploadUrls: mockResolveImageUploadUrls,
}));

import { findCreateMessageHistory } from "../../api/src/data/messages.data";

const createdAt = new Date("2026-08-31T00:00:00.000Z");

function historyRow(
  partial: Partial<{
    messageId: string;
    role: "user" | "assistant";
    content: string;
    createdAt: Date;
    attachmentUploadId: string | null;
    attachmentKind: "image" | "audio" | null;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
    transcriptContent: string | null;
    transcriptCharCount: number | null;
  }> = {},
) {
  return {
    messageId: "message-1",
    role: "user" as const,
    content: "Question",
    createdAt,
    attachmentUploadId: null,
    attachmentKind: null,
    signedUrl: null,
    signedUrlExpiresAt: null,
    transcriptContent: null,
    transcriptCharCount: null,
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockResolveImageUploadUrls.mockResolvedValue(new Map());
});

describe("findCreateMessageHistory", () => {
  it("groups transcript bodies and resolves only image slots inside the cap", async () => {
    mockExecute.mockResolvedValueOnce([
      historyRow({
        messageId: "message-2",
        role: "assistant",
        content: "Answer",
      }),
      historyRow({
        attachmentUploadId: "audio-1",
        attachmentKind: "audio",
        transcriptContent: "Transcript",
        transcriptCharCount: 10,
      }),
      historyRow({
        attachmentUploadId: "image-1",
        attachmentKind: "image",
        signedUrl: "old-url",
        signedUrlExpiresAt: createdAt,
      }),
      historyRow({
        messageId: "message-0",
        content: "Older",
        attachmentUploadId: "image-2",
        attachmentKind: "image",
      }),
    ]);
    mockResolveImageUploadUrls.mockResolvedValueOnce(
      new Map([["image-1", "signed-url"]]),
    );

    await expect(
      findCreateMessageHistory("user-1", "conversation-1", 49, 1),
    ).resolves.toEqual([
      {
        id: "message-2",
        role: "assistant",
        content: "Answer",
        createdAt,
        transcriptContents: [],
        imageUrls: [],
        contextCharCount: 6,
      },
      {
        id: "message-1",
        role: "user",
        content: "Question",
        createdAt,
        transcriptContents: ["Transcript"],
        imageUrls: ["signed-url"],
        contextCharCount: 18,
      },
      {
        id: "message-0",
        role: "user",
        content: "Older",
        createdAt,
        transcriptContents: [],
        imageUrls: [],
        contextCharCount: 5,
      },
    ]);
    expect(mockExecute).toHaveBeenCalledOnce();
    const query = mockExecute.mock.calls[0][0];
    const compiledQuery = new PgDialect().sqlToQuery(query);
    expect(compiledQuery.sql).toContain("context_window_message_count");
    expect(compiledQuery.sql).toContain("with conversation_window");
    expect(mockResolveImageUploadUrls).toHaveBeenCalledWith("user-1", [
      {
        imageUploadId: "image-1",
        signedUrl: "old-url",
        signedUrlExpiresAt: createdAt,
      },
    ]);
  });
});
