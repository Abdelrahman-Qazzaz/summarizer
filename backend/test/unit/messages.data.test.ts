import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTransaction,
  mockSelect,
  mockDelete,
  mockDeleteWhere,
  mockDeleteReturning,
  mockInsert,
  mockValues,
  mockInsertReturning,
  mockUpdate,
  mockSet,
  mockUpdateWhere,
  mockAttachTranscriptions,
  mockCompleteConversationTurn,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSelect: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockDeleteReturning: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockAttachTranscriptions: vi.fn(),
  mockCompleteConversationTurn: vi.fn(),
}));

const transaction = {
  select: mockSelect,
  delete: mockDelete,
  insert: mockInsert,
  update: mockUpdate,
};

vi.mock("../../shared/db", async () => ({
  db: { transaction: mockTransaction },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../api/src/data/images.data", () => ({
  attachImagesToMessage: vi.fn(),
}));

vi.mock("../../api/src/data/conversations.data", () => ({
  completeConversationTurn: mockCompleteConversationTurn,
}));

vi.mock("../../shared/data/transcripts.data", () => ({
  attachTranscriptionsToMessage: mockAttachTranscriptions,
  findMessageTranscriptAttachments: vi.fn(),
}));

import {
  deleteOwnedMessage,
  patchOwnedUserMessage,
  persistAssistantMessage,
} from "../../api/src/data/messages.data";

function returnLockedConversation(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        limit: () => ({ for: vi.fn().mockResolvedValue(rows) }),
      }),
    }),
  });
}

function returnNewHead(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({
        orderBy: () => ({ limit: vi.fn().mockResolvedValue(rows) }),
      }),
    }),
  });
}

function returnTargetMessage(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({ limit: vi.fn().mockResolvedValue(rows) }),
    }),
  });
}

function returnImageRows(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      innerJoin: () => ({ where: vi.fn().mockResolvedValue(rows) }),
    }),
  });
}

function returnLockedImageRows(rows: unknown[]) {
  mockSelect.mockReturnValueOnce({
    from: () => ({
      where: () => ({ for: vi.fn().mockResolvedValue(rows) }),
    }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(
    async (callback: (executor: typeof transaction) => unknown) =>
      callback(transaction),
  );
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });
  mockInsert.mockReturnValue({ values: mockValues });
  mockValues.mockReturnValue({ returning: mockInsertReturning });
  mockUpdate.mockReturnValue({ set: mockSet });
  mockSet.mockReturnValue({ where: mockUpdateWhere });
  mockUpdateWhere.mockResolvedValue(undefined);
});

describe("deleteOwnedMessage", () => {
  it("does not delete while a response owns the conversation", async () => {
    returnLockedConversation([
      { activeTurnClaimToken: "claim-token", lastMessageId: "message-1" },
    ]);

    await expect(
      deleteOwnedMessage("user-1", "conversation-1", "message-1"),
    ).resolves.toEqual({ status: "active" });
    expect(mockDelete).not.toHaveBeenCalled();
  });

  it("deletes the target and later messages, then moves the head back", async () => {
    returnLockedConversation([
      { activeTurnClaimToken: null, lastMessageId: "message-2" },
    ]);
    returnTargetMessage([
      { id: "message-2", role: "assistant", createdAt: new Date(2) },
    ]);
    returnNewHead([{ id: "message-1" }]);
    returnImageRows([
      { imageUploadId: "image-1" },
      { imageUploadId: "image-2" },
    ]);
    mockDeleteReturning.mockResolvedValueOnce([
      { id: "message-2" },
      { id: "message-3" },
    ]);

    await expect(
      deleteOwnedMessage("user-1", "conversation-1", "message-2"),
    ).resolves.toEqual({
      status: "deleted",
      ids: ["message-2", "message-3"],
      imageUploadIds: ["image-1", "image-2"],
      lastMessageId: "message-1",
    });
    expect(mockSet).toHaveBeenCalledWith({
      lastMessageId: "message-1",
      updatedAt: expect.any(Date),
    });
  });

  it("returns null when the target message is not owned by the conversation", async () => {
    returnLockedConversation([
      { activeTurnClaimToken: null, lastMessageId: "message-2" },
    ]);
    returnTargetMessage([]);

    await expect(
      deleteOwnedMessage("user-1", "conversation-1", "message-1"),
    ).resolves.toBeNull();
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("patchOwnedUserMessage", () => {
  const input = {
    userId: "user-1",
    conversationId: "conversation-1",
    messageId: "message-2",
    content: "Edited question",
    attachmentUploadIds: ["image-kept", "image-new", "audio-2", "audio-1"],
    claimToken: "claim-token",
  };

  it("does not mutate when the conversation claim was lost", async () => {
    returnLockedConversation([]);

    await expect(patchOwnedUserMessage(input)).resolves.toEqual({
      status: "claim_lost",
    });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("rejects an assistant target before rewinding", async () => {
    returnLockedConversation([{ id: "conversation-1" }]);
    returnTargetMessage([
      { id: "message-2", role: "assistant", createdAt: new Date(2) },
    ]);

    await expect(patchOwnedUserMessage(input)).resolves.toEqual({
      status: "not_user",
    });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("replaces the turn and returns every removed image", async () => {
    returnLockedConversation([{ id: "conversation-1" }]);
    returnTargetMessage([
      { id: "message-2", role: "user", createdAt: new Date(2) },
    ]);
    returnLockedImageRows([
      { imageUploadId: "image-kept", messageId: "message-2" },
      { imageUploadId: "image-new", messageId: null },
    ]);
    returnImageRows([
      { imageUploadId: "image-old" },
      { imageUploadId: "image-tail" },
    ]);

    await expect(patchOwnedUserMessage(input)).resolves.toEqual({
      status: "patched",
      imageUploadIds: ["image-old", "image-tail"],
    });
    expect(mockAttachTranscriptions).toHaveBeenCalledWith(
      "message-2",
      ["audio-2", "audio-1"],
      transaction,
    );
    expect(mockSet).toHaveBeenCalledWith({ messageId: "message-2" });
    expect(mockSet).toHaveBeenCalledWith({
      content: "Edited question",
      updatedAt: expect.any(Date),
    });
    expect(mockSet).toHaveBeenCalledWith({
      lastMessageId: "message-2",
      updatedAt: expect.any(Date),
    });
  });

  it("does not rewind when an image was claimed by another message", async () => {
    returnLockedConversation([{ id: "conversation-1" }]);
    returnTargetMessage([
      { id: "message-2", role: "user", createdAt: new Date(2) },
    ]);
    returnLockedImageRows([
      { imageUploadId: "image-kept", messageId: "message-2" },
      { imageUploadId: "image-new", messageId: "message-9" },
    ]);

    await expect(patchOwnedUserMessage(input)).resolves.toEqual({
      status: "attachments_changed",
    });
    expect(mockDelete).not.toHaveBeenCalled();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("persistAssistantMessage", () => {
  it("stores the replacement answer and advances the claimed head", async () => {
    mockInsertReturning.mockResolvedValueOnce([{ id: "assistant-3" }]);
    mockCompleteConversationTurn.mockResolvedValueOnce(true);

    await expect(
      persistAssistantMessage({
        userId: "user-1",
        conversationId: "conversation-1",
        chosenModelId: "model-1",
        assistantContent: "Replacement answer",
        claimToken: "claim-token",
      }),
    ).resolves.toBe("assistant-3");
    expect(mockValues).toHaveBeenCalledWith({
      role: "assistant",
      content: "Replacement answer",
      chosenModelId: "model-1",
      conversationId: "conversation-1",
      userId: "user-1",
    });
    expect(mockCompleteConversationTurn).toHaveBeenCalledWith(
      "user-1",
      "conversation-1",
      "claim-token",
      "assistant-3",
      undefined,
      undefined,
      transaction,
    );
  });
});
