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
    currentTurnContextCharCount: number;
    currentTranscriptCount: number;
    messageId: string | null;
    role: "user" | "assistant" | null;
    content: string | null;
    createdAt: Date | null;
    attachmentUploadId: string | null;
    attachmentKind: "image" | "audio" | null;
    signedUrl: string | null;
    signedUrlExpiresAt: Date | null;
    transcriptContent: string | null;
    transcriptCharCount: number | null;
  }> = {},
) {
  return {
    currentTurnContextCharCount: 10,
    currentTranscriptCount: 1,
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
  it("admits history before resolving its image slots", async () => {
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
      findCreateMessageHistory({
        userId: "user-1",
        conversationId: "conversation-1",
        newMessageContentCharCount: 8,
        newTranscriptUploadIds: ["current-audio"],
        transcriptSeparatorCharCount: 2,
        maximumContextCharCount: 36,
        maximumMessageCount: 49,
        maximumImageCount: 1,
      }),
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
        contextCharCount: 20,
      },
    ]);
    expect(mockExecute).toHaveBeenCalledOnce();
    const query = mockExecute.mock.calls[0][0];
    const compiledQuery = new PgDialect().sqlToQuery(query);
    expect(compiledQuery.sql).toContain("context_window_message_count");
    expect(compiledQuery.sql).toContain("current_turn as");
    expect(compiledQuery.sql).toContain("recent_messages as");
    expect(compiledQuery.sql).not.toContain("admitted_messages");
    expect(mockResolveImageUploadUrls).toHaveBeenCalledWith("user-1", [
      {
        imageUploadId: "image-1",
        signedUrl: "old-url",
        signedUrlExpiresAt: createdAt,
      },
    ]);
  });
});
