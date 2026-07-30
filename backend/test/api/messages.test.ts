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
  mockImageWhere,
  mockImageOrderBy,
  mockImageRows,
  mockValidateModel,
  mockValidateModelInput,
  mockChatAI,
  mockCreateSignedUrls,
  mockDeleteFilesFromBucket,
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
  mockImageWhere: vi.fn(),
  mockImageOrderBy: vi.fn(),
  mockImageRows: vi.fn(),
  mockValidateModel: vi.fn(),
  mockValidateModelInput: vi.fn(),
  mockChatAI: vi.fn(),
  mockCreateSignedUrls: vi.fn(),
  mockDeleteFilesFromBucket: vi.fn(),
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
  createSignedUrls: mockCreateSignedUrls,
  deleteFilesFromBucket: mockDeleteFilesFromBucket,
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

// buildUserTurn is the real one: what the model is handed for an image turn is
// exactly what these tests are checking.
vi.mock("../../shared/ai/ai_client", async (importActual) => {
  const actual =
    await importActual<typeof import("../../shared/ai/ai_client")>();
  return {
    ...actual,
    getModelData: vi.fn(),
    validateModelOutput: mockValidateModel,
    validateModelInput: mockValidateModelInput,
    chatAI: mockChatAI,
  };
});

// Resolves to the mocked module above, so this is the stub table.
import { ImageUploads } from "../../shared/db";
import { createApp } from "../../services/api/app";
import {
  MAX_CONTEXT_CHARS,
  MAX_RESPONSE_TOKENS,
} from "../../services/api/src/controllers/messages.controller";
import { sessionCookieHeader } from "../helpers/session";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const messageId = "650e8400-e29b-41d4-a716-446655440111";
const userId = "user_01OWNER";
const modelId = "openai/gpt-4o-mini";
const createdAt = "2026-07-22T00:00:00.000Z";

const uploadId = "850e8400-e29b-41d4-a716-446655440333";

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

/** An image_uploads row as the projection in imageUploads.ts selects it. */
const imageRow = {
  uploadId,
  fileName: "diagram.png",
  mimeType: "image/png",
  sizeBytes: 1234,
  signedUrl: "https://bucket.test/diagram.png",
  // Far enough out that the row's cached signature is reused as-is.
  signedUrlExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  messageId,
};
const resolvedImage = {
  uploadId,
  fileName: "diagram.png",
  mimeType: "image/png",
  size: 1234,
  url: "https://bucket.test/diagram.png",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockSelect.mockImplementation(() => ({ from: mockFrom }));
  // Reads of image_uploads get their own chain: they end at `.where()` or
  // `.orderBy()` rather than `.limit()`, and interleave with the message reads
  // within one request, so sharing a mock would make either one's rows depend
  // on the other's call order.
  mockFrom.mockImplementation((table: unknown) =>
    table === ImageUploads
      ? { where: mockImageWhere }
      : { where: mockWhere },
  );
  mockWhere.mockImplementation(() => ({
    orderBy: mockOrderBy,
    limit: mockLimit,
  }));
  mockOrderBy.mockImplementation(() => ({ limit: mockLimit }));
  mockImageWhere.mockImplementation(() =>
    Object.assign(Promise.resolve(mockImageRows()), {
      orderBy: mockImageOrderBy,
    }),
  );
  mockImageOrderBy.mockImplementation(async () => mockImageRows());
  mockImageRows.mockReturnValue([]);
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
  mockValidateModelInput.mockResolvedValue(true);
  mockDeleteFilesFromBucket.mockResolvedValue([]);
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
    expect(await res.json()).toEqual({
      messages: [
        { ...userRow, attachments: [] },
        { ...assistantRow, attachments: [] },
      ],
    });
  });

  it("returns each user turn's images as its attachments", async () => {
    mockLimit.mockResolvedValueOnce([{ id: conversationId }]); // ownership
    mockOrderBy.mockResolvedValueOnce([userRow, assistantRow]);
    mockImageRows.mockReturnValue([imageRow]);

    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}/messages`, {
      headers: { Cookie: await sessionCookieHeader(userId) },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      messages: [
        { ...userRow, attachments: [resolvedImage] },
        // The image hangs off the user turn only.
        { ...assistantRow, attachments: [] },
      ],
    });
    // The row's signature was still fresh, so nothing was re-signed.
    expect(mockCreateSignedUrls).not.toHaveBeenCalled();
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
        { id: assistantRow.id, role: "assistant", content: "Old answer" },
        { id: messageId, role: "user", content: "Old question" },
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

  it("replays images a past turn was sent with", async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: conversationId }]) // ownership
      .mockResolvedValueOnce([
        { id: messageId, role: "user", content: "What is this?" },
      ]);
    // The image_uploads rows for that history turn.
    mockImageRows.mockReturnValue([imageRow]);
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
        {
          role: "user",
          content: [
            { type: "text", text: "What is this?" },
            { type: "image_url", imageUrl: { url: resolvedImage.url } },
          ],
        },
        // The new turn has no images of its own, so it stays a plain string.
        { role: "user", content: "Hi there" },
      ],
      expect.objectContaining({ onDelta: expect.any(Function) }),
    );
  });

  it("drops history beyond the character budget and caps the response", async () => {
    // Two of these fit in the budget; the third pushes it over.
    const long = "x".repeat(Math.floor(MAX_CONTEXT_CHARS / 3));
    mockLimit
      .mockResolvedValueOnce([{ id: conversationId }]) // ownership
      .mockResolvedValueOnce([
        // History, newest-first as the query returns it.
        { role: "user", content: `newest ${long}` },
        { role: "assistant", content: `middle ${long}` },
        { role: "user", content: `oldest ${long}` },
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

    const [, turns, opts] = mockChatAI.mock.calls[0];
    const labels = turns.map((t: { content: string }) => t.content.slice(0, 6));
    // The oldest turn fell off; the new one is always kept, last.
    expect(labels).toEqual(["middle", "newest", "Hi the"]);
    expect(opts.maxOutputTokens).toBe(MAX_RESPONSE_TOKENS);
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

  it("sends attachments as vision input and binds them to the user turn", async () => {
    mockLimit
      .mockResolvedValueOnce([{ id: conversationId }]) // ownership
      .mockResolvedValueOnce([]); // history
    // Not yet claimed by a message — what the send path is allowed to attach.
    mockImageRows.mockReturnValue([{ ...imageRow, messageId: null }]);
    mockInsertReturning
      .mockResolvedValueOnce([userRow])
      .mockResolvedValueOnce([assistantRow]);
    mockChatAI.mockResolvedValueOnce("Hello world");

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      attachmentUploadIds: [uploadId],
    });
    expect(res.status).toBe(200);
    const body = await res.text();

    // The turn the model sees carries the text and the signed image url.
    expect(mockChatAI).toHaveBeenCalledWith(
      modelId,
      [
        {
          role: "user",
          content: [
            { type: "text", text: "Hi there" },
            { type: "image_url", imageUrl: { url: resolvedImage.url } },
          ],
        },
      ],
      expect.objectContaining({ onDelta: expect.any(Function) }),
    );
    // The upload is claimed by the message that was just inserted.
    expect(mockSet).toHaveBeenCalledWith({ messageId });
    expect(body).toContain(JSON.stringify(resolvedImage));
  });

  it("rejects an attachment that is not the user's, or already sent", async () => {
    mockLimit.mockResolvedValueOnce([{ id: conversationId }]); // ownership
    mockImageRows.mockReturnValue([]); // no unattached row matches

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      attachmentUploadIds: [uploadId],
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Attachment not found" });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("rejects attachments on a model that can't read images with 400", async () => {
    mockValidateModelInput.mockResolvedValueOnce(false);

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      attachmentUploadIds: [uploadId],
    });

    expect(res.status).toBe(400);
    expect(mockSelect).not.toHaveBeenCalled();
    expect(mockInsert).not.toHaveBeenCalled();
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
  it("removes the message's images from the bucket", async () => {
    // Read before the delete, while the rows still exist.
    mockImageRows.mockReturnValue([
      { uploadId },
      { uploadId: "another-upload" },
    ]);
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
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith(userId, [
      uploadId,
      "another-upload",
    ]);
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
