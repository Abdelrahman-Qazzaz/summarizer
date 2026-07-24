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
  mockDelete,
  mockDeleteWhere,
  mockDeleteReturning,
  mockValidateModel,
  mockChatAI,
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
  mockDelete: vi.fn(),
  mockDeleteWhere: vi.fn(),
  mockDeleteReturning: vi.fn(),
  mockValidateModel: vi.fn(),
  mockChatAI: vi.fn(),
}));

vi.mock("../../shared/db", () => ({
  db: {
    select: mockSelect,
    insert: mockInsert,
    update: mockUpdate,
    delete: mockDelete,
  },
  Conversations: {
    id: "id",
    title: "title",
    userId: "user_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  ChatMessages: {
    id: "id",
    role: "role",
    content: "content",
    chosenModelId: "chosen_model_id",
    conversationId: "conversation_id",
    userId: "user_id",
    createdAt: "created_at",
    updatedAt: "updated_at",
  },
  TextSummarizationJobs: { uploadId: "upload_id", userId: "user_id" },
  AudioTranscriptionJobs: { uploadId: "upload_id", userId: "user_id" },
  jobStatusEnum: {
    enumValues: ["queued", "processing", "completed", "failed"],
  },
}));

vi.mock("../../shared/ai/ai_client", () => ({
  ai_client: {},
  pingAi: vi.fn(),
  getModelData: vi.fn(),
  validateModel: mockValidateModel,
  chatAI: mockChatAI,
  DEFAULT_MODELS: {
    TRANSCRIBE: "openai/gpt-4o-mini-transcribe",
    PROMPT: "openai/gpt-4o-mini",
  },
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const messageId = "650e8400-e29b-41d4-a716-446655440111";
const userId = "user_01OWNER";
const modelId = "openai/gpt-4o-mini";
const createdAt = "2026-07-22T00:00:00.000Z";

const userRow = {
  id: messageId,
  role: "user",
  content: "Hi there",
  chosenModelId: null,
  conversationId,
  createdAt,
};
const assistantRow = {
  id: "750e8400-e29b-41d4-a716-446655440222",
  role: "assistant",
  content: "Hello world",
  chosenModelId: modelId,
  conversationId,
  createdAt,
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
  mockFrom.mockImplementation(() => ({ where: mockWhere }));
  mockWhere.mockImplementation(() => ({
    orderBy: mockOrderBy,
    limit: mockLimit,
  }));
  mockOrderBy.mockImplementation(() => ({ limit: mockLimit }));
  mockInsert.mockImplementation(() => ({ values: mockValues }));
  mockValues.mockImplementation(() => ({ returning: mockInsertReturning }));
  mockUpdate.mockImplementation(() => ({ set: mockSet }));
  mockSet.mockImplementation(() => ({ where: mockUpdateWhere }));
  mockUpdateWhere.mockResolvedValue([]);
  mockDelete.mockImplementation(() => ({ where: mockDeleteWhere }));
  mockDeleteWhere.mockImplementation(() => ({
    returning: mockDeleteReturning,
  }));
  mockValidateModel.mockResolvedValue(true);
});

describe("GET /conversations/:conversationId/messages", () => {
  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}/messages`);
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
  it("lists the conversation's messages oldest-first", async () => {
    // 1st select: ownership check; 2nd select: the messages themselves.
    mockLimit.mockResolvedValueOnce([{ id: conversationId }]);
    mockOrderBy.mockResolvedValueOnce([userRow, assistantRow]);
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}/messages`, {
      headers: { Cookie: await sessionCookieHeader(userId) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ messages: [userRow, assistantRow] });
  });
  it("returns 404 when the conversation is not owned by the user", async () => {
    mockLimit.mockResolvedValueOnce([]);
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}/messages`, {
      headers: { Cookie: await sessionCookieHeader(userId) },
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /conversations/:conversationId/messages", () => {
  function postMessage(body: unknown, signal?: AbortSignal) {
    return sessionCookieHeader(userId).then(async (cookie) =>
      (await createApp()).request(
        `http://localhost/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal,
        },
      ),
    );
  }

  it("streams deltas over SSE and persists both turns", async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: conversationId }]) // ownership
      .mockResolvedValueOnce([]); // history
    mockInsertReturning
      .mockResolvedValueOnce([userRow])
      .mockResolvedValueOnce([assistantRow]);
    mockChatAI.mockImplementation(
      async (
        _model: string,
        _turns: unknown,
        opts: { onDelta: (d: string) => Promise<void> },
      ) => {
        await opts.onDelta("Hello ");
        await opts.onDelta("world");
        return "Hello world";
      },
    );

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");

    const body = await res.text();
    expect(body).toContain("event: user_message");
    expect(body).toContain("event: delta");
    expect(body).toContain(JSON.stringify({ delta: "Hello " }));
    expect(body).toContain(JSON.stringify({ delta: "world" }));
    expect(body).toContain("event: done");
    expect(body).not.toContain("event: error");

    expect(mockChatAI).toHaveBeenCalledWith(
      modelId,
      [{ role: "user", content: "Hi there" }],
      expect.objectContaining({ onDelta: expect.any(Function) }),
    );
    // Both the user turn and the assistant reply were persisted.
    expect(mockValues).toHaveBeenCalledWith({
      role: "user",
      content: "Hi there",
      conversationId,
      userId,
    });
    expect(mockValues).toHaveBeenCalledWith({
      role: "assistant",
      content: "Hello world",
      chosenModelId: modelId,
      conversationId,
      userId,
    });
  });

  it("persists both turns when the client disconnects mid-stream", async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: conversationId }])
      .mockResolvedValueOnce([]);
    mockInsertReturning
      .mockResolvedValueOnce([userRow])
      .mockResolvedValueOnce([assistantRow]);

    const client = new AbortController();
    // Awaiting each delta mirrors chatAI: if emitting one could block on the
    // dead connection, the run would stall here and never reach the insert.
    mockChatAI.mockImplementation(
      async (
        _model: string,
        _turns: unknown,
        opts: { onDelta: (d: string) => void | Promise<void> },
      ) => {
        await opts.onDelta("Hello ");
        client.abort(); // the user closes the tab mid-answer
        for (const chunk of ["w", "o", "r", "l", "d"]) await opts.onDelta(chunk);
        return "Hello world";
      },
    );

    const res = await postMessage(
      { messageContent: "Hi there", chosenModelId: modelId },
      client.signal,
    );
    expect(res.status).toBe(200);

    // The run outlives the connection: the assistant turn still lands.
    await vi.waitFor(() =>
      expect(mockValues).toHaveBeenCalledWith({
        role: "assistant",
        content: "Hello world",
        chosenModelId: modelId,
        conversationId,
        userId,
      }),
    );
  });

  it("replays prior history to the model, oldest first", async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: conversationId }])
      // History arrives newest-first from the query; the controller reverses it.
      .mockResolvedValueOnce([
        { role: "assistant", content: "Old answer" },
        { role: "user", content: "Old question" },
      ]);
    mockInsertReturning
      .mockResolvedValueOnce([userRow])
      .mockResolvedValueOnce([assistantRow]);
    mockChatAI.mockResolvedValueOnce("Hello world");

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(mockChatAI).toHaveBeenCalledWith(
      modelId,
      [
        { role: "user", content: "Old question" },
        { role: "assistant", content: "Old answer" },
        { role: "user", content: "Hi there" },
      ],
      expect.objectContaining({ onDelta: expect.any(Function) }),
    );
  });

  it("emits an SSE error event and skips the assistant insert when the model fails", async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: conversationId }])
      .mockResolvedValueOnce([]);
    mockInsertReturning.mockResolvedValueOnce([userRow]);
    mockChatAI.mockRejectedValueOnce(new Error("provider exploded"));

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: user_message");
    expect(body).toContain("event: error");
    expect(body).not.toContain("event: done");
    // Only the user turn was persisted.
    expect(mockInsert).toHaveBeenCalledTimes(1);
  });

  it("returns 404 when the conversation is not owned by the user", async () => {
    // Ownership and the (discarded) history fetch both run; resolve both empty.
    mockLimit.mockResolvedValue([]);
    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(404);
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects an invalid model with 400 before touching the db", async () => {
    // Model validation now runs in the body-schema middleware, ahead of the
    // handler's ownership check.
    mockValidateModel.mockResolvedValueOnce(false);
    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: "nope",
    });
    expect(res.status).toBe(400);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects an empty message with 400", async () => {
    const res = await postMessage({ messageContent: "   ", chosenModelId: modelId });
    expect(res.status).toBe(400);
    expect(mockSelect).not.toHaveBeenCalled();
  });
});

describe("DELETE /conversations/:conversationId/messages/:messageId", () => {
  it("deletes the message", async () => {
    mockDeleteReturning.mockResolvedValueOnce([{ id: messageId }]);
    const res = await (
      await createApp()
    ).request(
      `http://localhost/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: { Cookie: await sessionCookieHeader(userId) },
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Message deleted" });
  });
  it("returns 404 when the message does not exist for the user", async () => {
    mockDeleteReturning.mockResolvedValueOnce([]);
    const res = await (
      await createApp()
    ).request(
      `http://localhost/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: { Cookie: await sessionCookieHeader(userId) },
      },
    );
    expect(res.status).toBe(404);
  });
  it("rejects a non-uuid message id with 400", async () => {
    const res = await (
      await createApp()
    ).request(
      `http://localhost/conversations/${conversationId}/messages/not-a-uuid`,
      {
        method: "DELETE",
        headers: { Cookie: await sessionCookieHeader(userId) },
      },
    );
    expect(res.status).toBe(400);
    expect(mockDelete).not.toHaveBeenCalled();
  });
});
