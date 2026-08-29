import { describe, it, expect, vi, beforeEach } from "vitest";
const {
  mockSelect,
  mockFrom,
  mockWhere,
  mockOrderBy,
  mockLimit,
  mockInsert,
  mockValues,
  mockInsertReturning,
  mockUpdate,
  mockSet,
  mockUpdateWhere,
  mockUpdateReturning,
  mockDelete,
  mockDeleteWhere,
  mockDeleteReturning,
  mockDeleteFilesFromBucket,
  mockImageWhere,
  mockImageRows,
} = vi.hoisted(() => ({
  mockSelect: vi.fn(),
  mockFrom: vi.fn(),
  mockWhere: vi.fn(),
  mockOrderBy: vi.fn(),
  mockLimit: vi.fn(),
  mockInsert: vi.fn(),
  mockValues: vi.fn(),
  mockInsertReturning: vi.fn(),
  mockUpdate: vi.fn(),
  mockSet: vi.fn(),
  mockUpdateWhere: vi.fn(),
  mockUpdateReturning: vi.fn(),
  mockDelete: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockDeleteReturning: vi.fn(),
  mockDeleteFilesFromBucket: vi.fn(),
  mockImageWhere: vi.fn(),
  mockImageRows: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../shared/bucket", () => ({
  deleteFilesFromBucket: mockDeleteFilesFromBucket,
  createSignedUrls: vi.fn(),
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

import { desc } from "drizzle-orm";
// Resolves to the mocked module above, so these are the stub column names.
import { ChatMessageAttachments, Conversations } from "../../shared/db";
import { createApp } from "../../api/app";
import { authedHeaders, sessionCookieHeader } from "../helpers/session";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const userId = "user_01OWNER";
const createdAt = "2026-07-22T00:00:00.000Z";
const updatedAt = "2026-07-22T00:00:00.000Z";
const row = { id: conversationId, title: "My chat", createdAt, updatedAt };

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
  // Deleting a conversation reads its messages' image_uploads first, and that
  // read is awaited at `.where()` rather than chaining on to `.limit()`.
  mockFrom.mockImplementation((table: unknown) =>
    table === ChatMessageAttachments
      ? { where: mockImageWhere }
      : { where: mockWhere },
  );
  mockWhere.mockImplementation(() => ({
    orderBy: mockOrderBy,
    limit: mockLimit,
  }));
  mockImageWhere.mockImplementation(async () => mockImageRows());
  mockImageRows.mockReturnValue([]);
  mockDeleteFilesFromBucket.mockResolvedValue([]);
  mockInsert.mockImplementation(() => ({ values: mockValues }));
  mockValues.mockImplementation(() => ({ returning: mockInsertReturning }));
  mockUpdate.mockImplementation(() => ({ set: mockSet }));
  mockSet.mockImplementation(() => ({ where: mockUpdateWhere }));
  mockUpdateWhere.mockImplementation(() => ({
    returning: mockUpdateReturning,
  }));
  mockDelete.mockImplementation(() => ({ where: mockDeleteWhere }));
  mockDeleteWhere.mockImplementation(() => ({
    returning: mockDeleteReturning,
  }));
});

describe("GET /conversations", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/conversations");
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
  it("lists the user's conversations, most recently active first", async () => {
    mockOrderBy.mockResolvedValueOnce([row]);
    const res = await (
      await createApp()
    ).request("http://localhost/conversations", {
      headers: await authedHeaders(userId),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ conversations: [row] });
    // updatedAt, not createdAt: posting a message bumps it, so an old
    // conversation the user just replied in comes back to the top.
    expect(mockOrderBy).toHaveBeenCalledWith(
      desc(Conversations.updatedAt),
      desc(Conversations.id),
    );
  });
});

describe("GET /conversations/:conversationId", () => {
  it("returns the conversation for the owner", async () => {
    mockLimit.mockResolvedValueOnce([row]);
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}`, {
      headers: await authedHeaders(userId),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(row);
  });
  it("returns 404 when the conversation does not exist for the user", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}`, {
      headers: await authedHeaders(userId),
    });
    expect(res.status).toBe(404);
  });
  it("rejects a non-uuid id with 400", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/conversations/not-a-uuid", {
      headers: await authedHeaders(userId),
    });
    expect(res.status).toBe(400);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe("POST /conversations", () => {
  it("creates a conversation with the given title", async () => {
    mockInsertReturning.mockResolvedValueOnce([row]);
    const res = await (
      await createApp()
    ).request("http://localhost/conversations", {
      method: "POST",
      headers: {
        Cookie: await sessionCookieHeader(userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationTitle: "My chat" }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual(row);
    expect(mockValues).toHaveBeenCalledWith({ userId, title: "My chat" });
  });
  it("creates a conversation without a body (title falls back to the DB default)", async () => {
    mockInsertReturning.mockResolvedValueOnce([
      { ...row, title: "New conversation" },
    ]);
    const res = await (
      await createApp()
    ).request("http://localhost/conversations", {
      method: "POST",
      headers: await authedHeaders(userId),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ...row, title: "New conversation" });
    expect(mockValues).toHaveBeenCalledWith({ userId });
  });
  it("rejects an empty title with 400", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/conversations", {
      method: "POST",
      headers: {
        Cookie: await sessionCookieHeader(userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationTitle: "   " }),
    });
    expect(res.status).toBe(400);
    expect(mockInsert).not.toHaveBeenCalled();
  });
});

describe("PATCH /conversations/:conversationId", () => {
  it("renames the conversation", async () => {
    const renamed = { ...row, title: "Renamed" };
    mockUpdateReturning.mockResolvedValueOnce([renamed]);
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}`, {
      method: "PATCH",
      headers: {
        Cookie: await sessionCookieHeader(userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationTitle: "Renamed" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual(renamed);
    expect(mockSet).toHaveBeenCalledWith(
      expect.objectContaining({ title: "Renamed" }),
    );
  });
  it("returns 404 when the conversation does not exist for the user", async () => {
    mockUpdateReturning.mockResolvedValueOnce([]);
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}`, {
      method: "PATCH",
      headers: {
        Cookie: await sessionCookieHeader(userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ conversationTitle: "Renamed" }),
    });
    expect(res.status).toBe(404);
  });
  it("rejects a missing title with 400", async () => {
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}`, {
      method: "PATCH",
      headers: {
        Cookie: await sessionCookieHeader(userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(400);
    expect(mockUpdate).not.toHaveBeenCalled();
  });
});

describe("DELETE /conversations/:conversationId", () => {
  it("deletes the conversation", async () => {
    mockDeleteReturning.mockResolvedValueOnce([{ id: conversationId }]);
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}`, {
      method: "DELETE",
      headers: await authedHeaders(userId),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Conversation deleted" });
  });
  it("returns 404 when the conversation does not exist for the user", async () => {
    mockDeleteReturning.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([]);
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}`, {
      method: "DELETE",
      headers: await authedHeaders(userId),
    });
    expect(res.status).toBe(404);
  });

  it("returns 409 while the conversation has an active response", async () => {
    mockDeleteReturning.mockResolvedValueOnce([]);
    mockLimit.mockResolvedValueOnce([
      { ...row, activeTurnClaimToken: "claim-token" },
    ]);

    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}`, {
      method: "DELETE",
      headers: await authedHeaders(userId),
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: "A response is already in progress",
    });
    expect(mockDeleteFilesFromBucket).not.toHaveBeenCalled();
  });
});
