import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindOwnedConversation,
  mockRecordConversationContext,
  mockFindRecentMessagesWithContext,
  mockCreateMessage,
  mockFindConversationMessages,
  mockDeleteOwnedMessage,
  mockResolveUnattachedImages,
  mockResolveMessageImages,
  mockAttachImagesToMessage,
  mockFindMessageImageUploadIds,
  mockResolveImageUploadUrls,
  mockFindTranscript,
  mockFindTranscriptContents,
  mockDeleteFilesFromBucket,
  mockValidateModel,
  mockValidateModelInput,
  mockChatAI,
} = vi.hoisted(() => ({
  mockFindOwnedConversation: vi.fn(),
  mockRecordConversationContext: vi.fn(),
  mockFindRecentMessagesWithContext: vi.fn(),
  mockCreateMessage: vi.fn(),
  mockFindConversationMessages: vi.fn(),
  mockDeleteOwnedMessage: vi.fn(),
  mockResolveUnattachedImages: vi.fn(),
  mockResolveMessageImages: vi.fn(),
  mockAttachImagesToMessage: vi.fn(),
  mockFindMessageImageUploadIds: vi.fn(),
  mockResolveImageUploadUrls: vi.fn(),
  mockFindTranscript: vi.fn(),
  mockFindTranscriptContents: vi.fn(),
  mockDeleteFilesFromBucket: vi.fn(),
  mockValidateModel: vi.fn(),
  mockValidateModelInput: vi.fn(),
  mockChatAI: vi.fn(),
}));

// The data layer is mocked directly — these tests drive the controller's
// context assembly, streaming and (non-blocking) persistence, not the SQL. The
// join query behind findRecentMessagesWithContext is a data-layer concern. The
// table stubs stand in for the columns other controllers read at module scope
// when createApp wires the whole app.
vi.mock("../../shared/db", async () => ({
  db: {},
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../api/src/data/conversations.data", async (importActual) => ({
  ...(await importActual<
    typeof import("../../api/src/data/conversations.data")
  >()),
  findOwnedConversation: mockFindOwnedConversation,
  recordConversationContext: mockRecordConversationContext,
}));

vi.mock("../../api/src/data/messages.data", async (importActual) => ({
  ...(await importActual<typeof import("../../api/src/data/messages.data")>()),
  findRecentMessagesWithContext: mockFindRecentMessagesWithContext,
  createMessage: mockCreateMessage,
  findConversationMessages: mockFindConversationMessages,
  deleteOwnedMessage: mockDeleteOwnedMessage,
}));

vi.mock("../../api/src/data/images.data", async (importActual) => ({
  ...(await importActual<typeof import("../../api/src/data/images.data")>()),
  resolveUnattachedImages: mockResolveUnattachedImages,
  resolveMessageImages: mockResolveMessageImages,
  attachImagesToMessage: mockAttachImagesToMessage,
  findMessageImageUploadIds: mockFindMessageImageUploadIds,
  resolveImageUploadUrls: mockResolveImageUploadUrls,
}));

vi.mock("../../shared/data/transcripts.data", async (importActual) => ({
  ...(await importActual<typeof import("../../shared/data/transcripts.data")>()),
  findTranscript: mockFindTranscript,
  findTranscriptContents: mockFindTranscriptContents,
}));

vi.mock("../../shared/bucket", () => ({
  deleteFilesFromBucket: mockDeleteFilesFromBucket,
  createSignedUrls: vi.fn(),
  IMAGE_URL_TTL_SECONDS: 7 * 24 * 60 * 60,
}));

// buildUserTurn is the real one: what the model is handed for an image turn is
// exactly what these tests are checking.
vi.mock("../../shared/ai/ai_chat_client", async (importActual) => {
  const actual =
    await importActual<typeof import("../../shared/ai/ai_chat_client")>();
  return {
    ...actual,
    getChatModelData: vi.fn(),
    validateChatModelOutput: mockValidateModel,
    validateChatModelInput: mockValidateModelInput,
    chatAI: mockChatAI,
  };
});

import { createApp } from "../../api/app";
import {
  MAX_CONTEXT_CHARS,
  MAX_RESPONSE_TOKENS,
} from "../../api/src/controllers/messages.controller";
import { sessionCookieHeader } from "../helpers/session";
import type { ContextMessage } from "../../api/src/data/messages.data";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const messageId = "650e8400-e29b-41d4-a716-446655440111";
const userId = "user_01OWNER";
const modelId = "openai/gpt-4o-mini";
const createdAt = "2026-07-22T00:00:00.000Z";

const uploadId = "850e8400-e29b-41d4-a716-446655440333";

const ownedConversation = {
  id: conversationId,
  title: "A chat",
  createdAt,
  updatedAt: createdAt,
  contextHash: null,
};

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

const resolvedImage = {
  uploadId,
  fileName: "diagram.png",
  mimeType: "image/png",
  size: 1234,
  url: "https://bucket.test/diagram.png",
};

/** A history turn as findRecentMessagesWithContext hands it back, newest first. */
function contextMessage(partial: Partial<ContextMessage> = {}): ContextMessage {
  return {
    id: messageId,
    role: "user",
    content: "",
    createdAt: new Date(createdAt),
    audioUploadId: null,
    transcriptCharCount: null,
    images: [],
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindOwnedConversation.mockResolvedValue(ownedConversation);
  mockFindRecentMessagesWithContext.mockResolvedValue([]);
  mockResolveUnattachedImages.mockResolvedValue([]);
  mockResolveMessageImages.mockResolvedValue(new Map());
  mockResolveImageUploadUrls.mockResolvedValue(new Map());
  mockFindTranscript.mockResolvedValue(null);
  mockFindTranscriptContents.mockResolvedValue(new Map());
  mockCreateMessage.mockImplementation(async (message: { role: string }) =>
    message.role === "user" ? userRow : assistantRow,
  );
  mockAttachImagesToMessage.mockResolvedValue(undefined);
  mockRecordConversationContext.mockResolvedValue(undefined);
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
    expect(mockFindOwnedConversation).not.toHaveBeenCalled();
  });

  it("lists the conversation's messages oldest-first", async () => {
    mockFindConversationMessages.mockResolvedValueOnce([userRow, assistantRow]);
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
    mockFindConversationMessages.mockResolvedValueOnce([userRow, assistantRow]);
    mockResolveMessageImages.mockResolvedValueOnce(
      new Map([[messageId, [resolvedImage]]]),
    );

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
  });

  it("returns 404 when the conversation is not owned by the user", async () => {
    mockFindOwnedConversation.mockResolvedValueOnce(null);
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

  it("streams deltas then a hash, and persists the turn", async () => {
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
    expect(body).toContain("event: delta");
    expect(body).toContain(JSON.stringify({ delta: "Hello " }));
    expect(body).toContain(JSON.stringify({ delta: "world" }));
    expect(body).toContain("event: hash");
    expect(body).not.toContain("event: error");
    // The hash trails the tokens the client rendered.
    expect(body.indexOf("event: delta")).toBeLessThan(
      body.indexOf("event: hash"),
    );

    expect(mockChatAI).toHaveBeenCalledWith(
      modelId,
      [{ role: "user", content: "Hi there" }],
      expect.objectContaining({ onDelta: expect.any(Function) }),
    );

    // The writes are fire-and-forget, so they land after the response resolves.
    await vi.waitFor(() => {
      expect(mockCreateMessage).toHaveBeenCalledWith({
        role: "user",
        content: "Hi there",
        conversationId,
        userId,
        audioUploadId: undefined,
      });
      expect(mockCreateMessage).toHaveBeenCalledWith({
        role: "assistant",
        content: "Hello world",
        chosenModelId: modelId,
        conversationId,
        userId,
      });
      expect(mockRecordConversationContext).toHaveBeenCalledWith(
        userId,
        conversationId,
        expect.any(String),
      );
    });
  });

  it("persists the turn even when the client disconnects mid-stream", async () => {
    const client = new AbortController();
    mockChatAI.mockImplementation(
      async (
        _model: string,
        _turns: unknown,
        opts: { onDelta: (d: string) => void | Promise<void> },
      ) => {
        await opts.onDelta("Hello ");
        client.abort(); // the user closes the tab mid-answer
        for (const chunk of ["w", "o", "r", "l", "d"])
          await opts.onDelta(chunk);
        return "Hello world";
      },
    );

    const res = await postMessage(
      { messageContent: "Hi there", chosenModelId: modelId },
      client.signal,
    );
    expect(res.status).toBe(200);
    await res.text().catch(() => {}); // the aborted stream may reject here

    // The run is decoupled from the response, so it completes and persists the
    // whole turn regardless of the disconnect. Persistence is fire-and-forget.
    await vi.waitFor(() => {
      expect(mockCreateMessage).toHaveBeenCalledWith({
        role: "user",
        content: "Hi there",
        conversationId,
        userId,
        audioUploadId: undefined,
      });
      expect(mockCreateMessage).toHaveBeenCalledWith({
        role: "assistant",
        content: "Hello world",
        chosenModelId: modelId,
        conversationId,
        userId,
      });
      expect(mockRecordConversationContext).toHaveBeenCalledWith(
        userId,
        conversationId,
        expect.any(String),
      );
    });
  });

  it("replays prior history to the model, oldest first", async () => {
    mockFindRecentMessagesWithContext.mockResolvedValueOnce([
      // History arrives newest-first from the query; the controller reverses it.
      contextMessage({ id: assistantRow.id, role: "assistant", content: "Old answer" }),
      contextMessage({ id: messageId, role: "user", content: "Old question" }),
    ]);
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

  it("reads only the transcripts of turns that fit the budget", async () => {
    // Newest turn fits; the older one's transcript alone blows the budget.
    mockFindRecentMessagesWithContext.mockResolvedValueOnce([
      contextMessage({
        id: assistantRow.id,
        content: "Newer",
        audioUploadId: "audio-fits",
        transcriptCharCount: 10,
      }),
      contextMessage({
        id: messageId,
        content: "Older",
        audioUploadId: "audio-huge",
        transcriptCharCount: MAX_CONTEXT_CHARS,
      }),
    ]);
    mockFindTranscriptContents.mockResolvedValueOnce(
      new Map([["audio-fits", "T"]]),
    );
    mockChatAI.mockResolvedValueOnce("Hello world");

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(200);
    await res.text();

    // The dropped turn's body is never fetched — only the admitted one's.
    expect(mockFindTranscriptContents).toHaveBeenCalledWith(userId, [
      "audio-fits",
    ]);
    // The over-budget turn didn't make the prompt.
    const [, turns] = mockChatAI.mock.calls[0];
    expect(turns).toHaveLength(2);
  });

  it("replays images a past turn was sent with", async () => {
    mockFindRecentMessagesWithContext.mockResolvedValueOnce([
      contextMessage({
        id: messageId,
        role: "user",
        content: "What is this?",
        images: [{ uploadId, signedUrl: null, signedUrlExpiresAt: null }],
      }),
    ]);
    mockResolveImageUploadUrls.mockResolvedValueOnce(
      new Map([[uploadId, resolvedImage.url]]),
    );
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
    mockFindRecentMessagesWithContext.mockResolvedValueOnce([
      contextMessage({ role: "user", content: `newest ${long}` }),
      contextMessage({ role: "assistant", content: `middle ${long}` }),
      contextMessage({ role: "user", content: `oldest ${long}` }),
    ]);
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

  describe("with a transcript attached", () => {
    const audioUploadId = "950e8400-e29b-41d4-a716-446655440444";
    const transcript = "and then the speaker said something important";

    it("splices the transcript into the turn and records the link", async () => {
      mockFindTranscript.mockResolvedValueOnce({ content: transcript });
      mockChatAI.mockResolvedValueOnce("Hello world");

      const res = await postMessage({
        messageContent: "Summarise this",
        chosenModelId: modelId,
        audioUploadId,
      });
      expect(res.status).toBe(200);
      await res.text();

      // The model sees transcript + prompt...
      expect(mockChatAI).toHaveBeenCalledWith(
        modelId,
        [{ role: "user", content: `${transcript}\n\nSummarise this` }],
        expect.objectContaining({ onDelta: expect.any(Function) }),
      );
      // ...but the row stores only what was typed, plus the link.
      await vi.waitFor(() =>
        expect(mockCreateMessage).toHaveBeenCalledWith({
          role: "user",
          content: "Summarise this",
          conversationId,
          userId,
          audioUploadId,
        }),
      );
      expect(mockFindTranscript).toHaveBeenCalledWith(userId, audioUploadId);
    });

    it("replays a past turn's transcript so follow-ups still see it", async () => {
      mockFindRecentMessagesWithContext.mockResolvedValueOnce([
        contextMessage({
          id: messageId,
          role: "user",
          content: "Summarise this",
          audioUploadId,
          transcriptCharCount: transcript.length,
        }),
      ]);
      mockFindTranscriptContents.mockResolvedValueOnce(
        new Map([[audioUploadId, transcript]]),
      );
      mockChatAI.mockResolvedValueOnce("Hello world");

      const res = await postMessage({
        messageContent: "What did they say about it?",
        chosenModelId: modelId,
      });
      expect(res.status).toBe(200);
      await res.text();

      const [, turns] = mockChatAI.mock.calls[0];
      expect(turns[0].content).toBe(`${transcript}\n\nSummarise this`);
    });

    it("returns 404 when the transcript isn't the caller's or isn't ready", async () => {
      // A row exists only for a completed job the user owns; otherwise none.
      mockFindTranscript.mockResolvedValueOnce(null);
      const res = await postMessage({
        messageContent: "Summarise this",
        chosenModelId: modelId,
        audioUploadId,
      });
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ message: "Transcript not found" });
      expect(mockChatAI).not.toHaveBeenCalled();
      expect(mockCreateMessage).not.toHaveBeenCalled();
    });

    it("refuses a transcript past the context budget rather than truncating it", async () => {
      mockFindTranscript.mockResolvedValueOnce({
        content: "x".repeat(MAX_CONTEXT_CHARS + 1),
      });

      const res = await postMessage({
        messageContent: "Summarise this",
        chosenModelId: modelId,
        audioUploadId,
      });
      expect(res.status).toBe(413);
      expect(await res.json()).toEqual({
        message: "Transcript is too long for one message",
        maxChars: MAX_CONTEXT_CHARS,
        chars: MAX_CONTEXT_CHARS + 1,
      });
      expect(mockChatAI).not.toHaveBeenCalled();
    });

    it("charges the transcript against the budget, dropping history to fit", async () => {
      const long = "x".repeat(Math.floor(MAX_CONTEXT_CHARS / 3));
      // Half the budget: one ~third-budget history turn still fits, two don't.
      mockFindTranscript.mockResolvedValueOnce({
        content: "y".repeat(MAX_CONTEXT_CHARS / 2),
      });
      mockFindRecentMessagesWithContext.mockResolvedValueOnce([
        contextMessage({ role: "user", content: `newest ${long}` }),
        contextMessage({ role: "assistant", content: `middle ${long}` }),
      ]);
      mockChatAI.mockResolvedValueOnce("Hello world");

      const res = await postMessage({
        messageContent: "Summarise this",
        chosenModelId: modelId,
        audioUploadId,
      });
      expect(res.status).toBe(200);
      await res.text();

      const [, turns] = mockChatAI.mock.calls[0];
      expect(turns).toHaveLength(2);
      expect(turns[0].content.slice(0, 6)).toBe("newest");
    });
  });

  it("emits an SSE error event and persists nothing when the model fails", async () => {
    mockChatAI.mockRejectedValueOnce(new Error("provider exploded"));

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("event: error");
    expect(body).not.toContain("event: hash");

    // The writes only run once a reply is known, so a failed turn saves nothing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("sends attachments as vision input and binds them to the user turn", async () => {
    mockResolveUnattachedImages.mockResolvedValueOnce([resolvedImage]);
    mockChatAI.mockResolvedValueOnce("Hello world");

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      attachmentUploadIds: [uploadId],
    });
    expect(res.status).toBe(200);
    await res.text();

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
    await vi.waitFor(() =>
      expect(mockAttachImagesToMessage).toHaveBeenCalledWith(userId, messageId, [
        uploadId,
      ]),
    );
  });

  it("rejects an attachment that is not the user's, or already sent", async () => {
    mockResolveUnattachedImages.mockResolvedValueOnce([]); // no unattached match

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      attachmentUploadIds: [uploadId],
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Attachment not found" });
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("rejects attachments on a model that can't read images with 400", async () => {
    mockValidateModelInput.mockResolvedValueOnce(false);

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      attachmentUploadIds: [uploadId],
    });

    expect(res.status).toBe(400);
    expect(mockFindOwnedConversation).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation is not owned by the user", async () => {
    mockFindOwnedConversation.mockResolvedValueOnce(null);
    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(404);
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("rejects an invalid model with 400 before touching the db", async () => {
    // Model validation runs in the body-schema middleware, ahead of the
    // handler's ownership check.
    mockValidateModel.mockResolvedValueOnce(false);
    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: "nope",
    });
    expect(res.status).toBe(400);
    expect(mockFindOwnedConversation).not.toHaveBeenCalled();
    expect(mockCreateMessage).not.toHaveBeenCalled();
  });

  it("rejects an empty message with 400", async () => {
    const res = await postMessage({
      messageContent: "   ",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(400);
    expect(mockFindOwnedConversation).not.toHaveBeenCalled();
  });
});

describe("DELETE /conversations/:conversationId/messages/:messageId", () => {
  it("deletes the message", async () => {
    mockFindMessageImageUploadIds.mockResolvedValueOnce([]);
    mockDeleteOwnedMessage.mockResolvedValueOnce({ id: messageId });
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
    mockFindMessageImageUploadIds.mockResolvedValueOnce([
      uploadId,
      "another-upload",
    ]);
    mockDeleteOwnedMessage.mockResolvedValueOnce({ id: messageId });

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
    mockFindMessageImageUploadIds.mockResolvedValueOnce([]);
    mockDeleteOwnedMessage.mockResolvedValueOnce(null);
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
    expect(mockDeleteOwnedMessage).not.toHaveBeenCalled();
  });
});
