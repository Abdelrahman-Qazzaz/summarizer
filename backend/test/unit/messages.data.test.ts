import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockTransaction,
  mockSelect,
  mockDelete,
  mockDeleteWhere,
  mockDeleteReturning,
  mockUpdate,
  mockSet,
  mockUpdateWhere,
} = vi.hoisted(() => ({
  mockTransaction: vi.fn(),
  mockSelect: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockDeleteReturning: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
}));

const transaction = {
  select: mockSelect,
  delete: mockDelete,
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
  completeConversationTurn: vi.fn(),
}));

import { deleteOwnedMessage } from "../../api/src/data/messages.data";

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

beforeEach(() => {
  vi.clearAllMocks();
  mockTransaction.mockImplementation(
    async (callback: (executor: typeof transaction) => unknown) =>
      callback(transaction),
  );
  mockDelete.mockReturnValue({ where: mockDeleteWhere });
  mockDeleteWhere.mockReturnValue({ returning: mockDeleteReturning });
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

  it("moves the head to the newest remaining message when deleting the head", async () => {
    returnLockedConversation([
      { activeTurnClaimToken: null, lastMessageId: "message-2" },
    ]);
    mockDeleteReturning.mockResolvedValueOnce([{ id: "message-2" }]);
    returnNewHead([{ id: "message-1" }]);

    await expect(
      deleteOwnedMessage("user-1", "conversation-1", "message-2"),
    ).resolves.toEqual({ status: "deleted", id: "message-2" });
    expect(mockSet).toHaveBeenCalledWith({ lastMessageId: "message-1" });
  });

  it("leaves the head unchanged when deleting an older message", async () => {
    returnLockedConversation([
      { activeTurnClaimToken: null, lastMessageId: "message-2" },
    ]);
    mockDeleteReturning.mockResolvedValueOnce([{ id: "message-1" }]);

    await expect(
      deleteOwnedMessage("user-1", "conversation-1", "message-1"),
    ).resolves.toEqual({ status: "deleted", id: "message-1" });
    expect(mockSelect).toHaveBeenCalledOnce();
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});
