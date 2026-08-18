import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindOwnedConversation,
  mockClaimConversationTurn,
  mockReleaseConversationTurn,
  mockFindRecentMessagesWithContext,
  mockPersistChatTurn,
  mockFindConversationMessages,
  mockDeleteOwnedMessage,
  mockResolveUnattachedImages,
  mockResolveMessageImages,
  mockFindMessageImageUploadIds,
  mockResolveImageUploadUrls,
  mockFindMessageTranscriptAttachments,
  mockFindTranscripts,
  mockDeleteFilesFromBucket,
  mockValidateModel,
  mockValidateModelInput,
  mockChatAI,
  mockGenerateTitle,
} = vi.hoisted(() => ({
  mockFindOwnedConversation: vi.fn(),
  mockClaimConversationTurn: vi.fn(),
  mockReleaseConversationTurn: vi.fn(),
  mockFindRecentMessagesWithContext: vi.fn(),
  mockPersistChatTurn: vi.fn(),
  mockFindConversationMessages: vi.fn(),
  mockDeleteOwnedMessage: vi.fn(),
  mockResolveUnattachedImages: vi.fn(),
  mockResolveMessageImages: vi.fn(),
  mockFindMessageImageUploadIds: vi.fn(),
  mockResolveImageUploadUrls: vi.fn(),
  mockFindMessageTranscriptAttachments: vi.fn(),
  mockFindTranscripts: vi.fn(),
  mockDeleteFilesFromBucket: vi.fn(),
  mockValidateModel: vi.fn(),
  mockValidateModelInput: vi.fn(),
  mockChatAI: vi.fn(),
  mockGenerateTitle: vi.fn(),
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
  claimConversationTurn: mockClaimConversationTurn,
  releaseConversationTurn: mockReleaseConversationTurn,
}));

vi.mock("../../api/src/data/messages.data", async (importActual) => ({
  ...(await importActual<typeof import("../../api/src/data/messages.data")>()),
  findRecentMessagesWithContext: mockFindRecentMessagesWithContext,
  persistChatTurn: mockPersistChatTurn,
  findConversationMessages: mockFindConversationMessages,
  deleteOwnedMessage: mockDeleteOwnedMessage,
}));

vi.mock("../../api/src/data/images.data", async (importActual) => ({
  ...(await importActual<typeof import("../../api/src/data/images.data")>()),
  resolveUnattachedImages: mockResolveUnattachedImages,
  resolveMessageImages: mockResolveMessageImages,
  findMessageImageUploadIds: mockFindMessageImageUploadIds,
  resolveImageUploadUrls: mockResolveImageUploadUrls,
}));

vi.mock("../../shared/data/transcripts.data", async (importActual) => ({
  ...(await importActual<
    typeof import("../../shared/data/transcripts.data")
  >()),
  findMessageTranscriptAttachments: mockFindMessageTranscriptAttachments,
  findTranscripts: mockFindTranscripts,
  attachTranscriptionsToMessage: vi.fn(),
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
    generateTitle: mockGenerateTitle,
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
  lastMessageId: null,
  activeTurnClaimToken: null,
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
    transcripts: [],
    images: [],
    ...partial,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindOwnedConversation.mockResolvedValue(ownedConversation);
  mockClaimConversationTurn.mockResolvedValue("claim-token");
  mockReleaseConversationTurn.mockResolvedValue(undefined);
  mockFindRecentMessagesWithContext.mockResolvedValue([]);
  mockResolveUnattachedImages.mockResolvedValue([]);
  mockResolveMessageImages.mockResolvedValue(new Map());
  mockResolveImageUploadUrls.mockResolvedValue(new Map());
  mockFindMessageTranscriptAttachments.mockResolvedValue(new Map());
  mockFindTranscripts.mockResolvedValue(new Map());
  mockPersistChatTurn.mockResolvedValue(assistantRow.id);
  mockValidateModel.mockResolvedValue(true);
  mockValidateModelInput.mockResolvedValue(true);
  mockGenerateTitle.mockResolvedValue("Friendly greeting");
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
      lastMessageId: null,
      messages: [
        { ...userRow, attachments: [], transcriptAttachments: [] },
        { ...assistantRow, attachments: [], transcriptAttachments: [] },
      ],
    });
  });

  it("revalidates unchanged message history with an ETag", async () => {
    mockFindConversationMessages.mockResolvedValue([userRow, assistantRow]);
    const app = await createApp();
    const cookie = await sessionCookieHeader(userId);
    const url = `http://localhost/conversations/${conversationId}/messages`;

    const first = await app.request(url, {
      headers: { Cookie: cookie },
    });
    const etag = first.headers.get("ETag");

    expect(first.status).toBe(200);
    expect(etag).toBeTruthy();
    expect(first.headers.get("Cache-Control")).toBe("private, no-cache");

    const second = await app.request(url, {
      headers: { Cookie: cookie, "If-None-Match": etag as string },
    });

    expect(second.status).toBe(304);
    expect(await second.text()).toBe("");
    expect(second.headers.get("Cache-Control")).toBe("private, no-cache");
  });

  it("returns each user turn's attachments", async () => {
    mockFindConversationMessages.mockResolvedValueOnce([userRow, assistantRow]);
    mockResolveMessageImages.mockResolvedValueOnce(
      new Map([[messageId, [resolvedImage]]]),
    );
    mockFindMessageTranscriptAttachments.mockResolvedValueOnce(
      new Map([
        [
          messageId,
          [
            {
              uploadId: "950e8400-e29b-41d4-a716-446655440444",
              fileName: "interview.mp3",
              title: "Customer interview",
              source: "audio",
              charCount: 120,
            },
          ],
        ],
      ]),
    );

    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}/messages`, {
      headers: { Cookie: await sessionCookieHeader(userId) },
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      lastMessageId: null,
      messages: [
        {
          ...userRow,
          attachments: [resolvedImage],
          transcriptAttachments: [
            {
              uploadId: "950e8400-e29b-41d4-a716-446655440444",
              fileName: "interview.mp3",
              title: "Customer interview",
              source: "audio",
            },
          ],
        },
        { ...assistantRow, attachments: [], transcriptAttachments: [] },
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
    const requestBody =
      body && typeof body === "object" && !Array.isArray(body)
        ? { lastMessageId: null, ...body }
        : body;
    return sessionCookieHeader(userId).then(async (cookie) =>
      (await createApp()).request(
        `http://localhost/conversations/${conversationId}/messages`,
        {
          method: "POST",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(requestBody),
          signal,
        },
      ),
    );
  }

  it("requires the client to identify the conversation head", async () => {
    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        Cookie: await sessionCookieHeader(userId),
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messageContent: "Hi there",
        chosenModelId: modelId,
      }),
    });

    expect(res.status).toBe(400);
    expect(mockClaimConversationTurn).not.toHaveBeenCalled();
  });

  it("claims the exact head submitted by the client", async () => {
    mockChatAI.mockResolvedValueOnce("Hello world");

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      lastMessageId: messageId,
    });
    await res.text();

    expect(mockClaimConversationTurn).toHaveBeenCalledWith(
      userId,
      conversationId,
      messageId,
    );
    expect(mockGenerateTitle).not.toHaveBeenCalled();
  });

  it("fetches message context while the conversation claim is pending", async () => {
    let resolveClaim!: (claimToken: string) => void;
    mockClaimConversationTurn.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveClaim = resolve;
        }),
    );
    mockChatAI.mockResolvedValueOnce("Hello world");

    const responsePromise = postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });

    await vi.waitFor(() => {
      expect(mockResolveUnattachedImages).toHaveBeenCalled();
      expect(mockFindRecentMessagesWithContext).toHaveBeenCalled();
    });

    resolveClaim("claim-token");
    const res = await responsePromise;
    expect(res.status).toBe(200);
    await res.text();
  });

  it("releases an acquired claim when a context read fails", async () => {
    mockFindRecentMessagesWithContext.mockRejectedValueOnce(
      new Error("history unavailable"),
    );

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });

    expect(res.status).toBe(500);
    expect(mockReleaseConversationTurn).toHaveBeenCalledWith(
      userId,
      conversationId,
      "claim-token",
    );
    expect(mockChatAI).not.toHaveBeenCalled();
  });

  it("returns 409 without starting the model when the head cannot be claimed", async () => {
    mockClaimConversationTurn.mockResolvedValueOnce(null);

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: "Conversation changed or a response is already in progress",
    });
    expect(mockChatAI).not.toHaveBeenCalled();
    expect(mockPersistChatTurn).not.toHaveBeenCalled();
  });

  it("never compresses the reply stream, even when the client accepts gzip", async () => {
    // Response compression is mounted app-wide. Buffering this stream would
    // turn a token-by-token reply into one chunk at the end: invisible to
    // every other test, obvious to every user.
    mockChatAI.mockImplementation(
      async (
        _model: string,
        _turns: unknown,
        opts: { onDelta: (d: string) => Promise<void> },
      ) => {
        await opts.onDelta("Hello ");
        return "Hello";
      },
    );

    const res = await (
      await createApp()
    ).request(`http://localhost/conversations/${conversationId}/messages`, {
      method: "POST",
      headers: {
        Cookie: await sessionCookieHeader(userId),
        "Content-Type": "application/json",
        "Accept-Encoding": "gzip, deflate",
      },
      body: JSON.stringify({
        messageContent: "Hi there",
        chosenModelId: modelId,
        lastMessageId: null,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("Content-Encoding")).toBeNull();
    expect(await res.text()).toContain("event: delta");
  });

  it("streams deltas then the persisted conversation head", async () => {
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
    expect(body).toContain("event: done");
    expect(body).toContain(JSON.stringify({ lastMessageId: assistantRow.id }));
    expect(body).not.toContain("event: error");
    // The persisted head trails the tokens the client rendered.
    expect(body.indexOf("event: delta")).toBeLessThan(
      body.indexOf("event: done"),
    );

    expect(mockChatAI).toHaveBeenCalledWith(
      modelId,
      [{ role: "user", content: "Hi there" }],
      expect.objectContaining({ onDelta: expect.any(Function) }),
    );

    expect(mockPersistChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        userId,
        conversationId,
        content: "Hi there",
        assistantContent: "Hello world",
        chosenModelId: modelId,
        attachmentUploadIds: [],
        audioUploadIds: [],
        conversationTitle: "Friendly greeting",
        claimToken: "claim-token",
      }),
    );
    expect(mockGenerateTitle).toHaveBeenCalledWith("conversation", "Hi there");
  });

  it("uses the first message as a fallback when title generation fails", async () => {
    mockChatAI.mockResolvedValueOnce("Hello world");
    mockGenerateTitle.mockRejectedValueOnce(new Error("title model failed"));

    const response = await postMessage({
      messageContent: "  Plan   the next quarter  ",
      chosenModelId: modelId,
    });
    await response.text();

    expect(mockPersistChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationTitle: "Plan the next quarter",
      }),
    );
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
    await vi.waitFor(() =>
      expect(mockPersistChatTurn).toHaveBeenCalledWith(
        expect.objectContaining({
          userId,
          conversationId,
          content: "Hi there",
          assistantContent: "Hello world",
        }),
      ),
    );
  });

  it("replays prior history to the model, oldest first", async () => {
    mockFindRecentMessagesWithContext.mockResolvedValueOnce([
      // History arrives newest-first from the query; the controller reverses it.
      contextMessage({
        id: assistantRow.id,
        role: "assistant",
        content: "Old answer",
      }),
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
        transcripts: [
          {
            uploadId: "audio-fits",
            fileName: "fits.mp3",
            title: null,
            source: "audio",
            charCount: 10,
          },
        ],
      }),
      contextMessage({
        id: messageId,
        content: "Older",
        transcripts: [
          {
            uploadId: "audio-huge",
            fileName: "huge.mp3",
            title: null,
            source: "audio",
            charCount: MAX_CONTEXT_CHARS,
          },
        ],
      }),
    ]);
    mockFindTranscripts.mockResolvedValueOnce(
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
    expect(mockFindTranscripts).toHaveBeenCalledWith(userId, [
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

  it("rejects a text-only model when the assembled history contains an image", async () => {
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
    mockValidateModelInput.mockResolvedValueOnce(false);

    const response = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Invalid model: must accept image input",
    });
    expect(mockChatAI).not.toHaveBeenCalled();
    expect(mockPersistChatTurn).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledWith(
      userId,
      conversationId,
      "claim-token",
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

  describe("with transcription jobs attached", () => {
    const firstAudioUploadId = "950e8400-e29b-41d4-a716-446655440444";
    const secondAudioUploadId = "a50e8400-e29b-41d4-a716-446655440555";
    const firstTranscript = "the interview transcript";
    const secondTranscript = "the product demonstration transcript";

    it("sends multiple transcripts in order and records their links", async () => {
      mockFindTranscripts.mockResolvedValueOnce(
        new Map([
          [firstAudioUploadId, firstTranscript],
          [secondAudioUploadId, secondTranscript],
        ]),
      );
      mockChatAI.mockResolvedValueOnce("Hello world");

      const response = await postMessage({
        messageContent: "Compare these",
        chosenModelId: modelId,
        audioUploadIds: [firstAudioUploadId, secondAudioUploadId],
      });
      expect(response.status).toBe(200);
      await response.text();

      expect(mockChatAI).toHaveBeenCalledWith(
        modelId,
        [
          {
            role: "user",
            content: `${firstTranscript}\n\n${secondTranscript}\n\nCompare these`,
          },
        ],
        expect.objectContaining({ onDelta: expect.any(Function) }),
      );
      await vi.waitFor(() =>
        expect(mockPersistChatTurn).toHaveBeenCalledWith(
          expect.objectContaining({
            content: "Compare these",
            audioUploadIds: [firstAudioUploadId, secondAudioUploadId],
          }),
        ),
      );
      expect(mockFindTranscripts).toHaveBeenCalledWith(userId, [
        firstAudioUploadId,
        secondAudioUploadId,
      ]);
    });

    it("replays all transcripts from a past turn", async () => {
      mockFindRecentMessagesWithContext.mockResolvedValueOnce([
        contextMessage({
          id: messageId,
          role: "user",
          content: "Compare these",
          transcripts: [
            {
              uploadId: firstAudioUploadId,
              fileName: "interview.mp3",
              title: "Customer interview",
              source: "audio",
              charCount: firstTranscript.length,
            },
            {
              uploadId: secondAudioUploadId,
              fileName: "Product demo",
              title: "Product demonstration",
              source: "youtube",
              charCount: secondTranscript.length,
            },
          ],
        }),
      ]);
      mockFindTranscripts.mockResolvedValueOnce(
        new Map([
          [firstAudioUploadId, firstTranscript],
          [secondAudioUploadId, secondTranscript],
        ]),
      );
      mockChatAI.mockResolvedValueOnce("Hello world");

      const response = await postMessage({
        messageContent: "What do they have in common?",
        chosenModelId: modelId,
      });
      expect(response.status).toBe(200);
      await response.text();

      const [, turns] = mockChatAI.mock.calls[0];
      expect(turns[0].content).toContain(firstTranscript);
      expect(turns[0].content).toContain(secondTranscript);
      expect(turns[0].content.indexOf(firstTranscript)).toBeLessThan(
        turns[0].content.indexOf(secondTranscript),
      );
    });

    it("returns 404 when any requested transcript is unavailable", async () => {
      mockFindTranscripts.mockResolvedValueOnce(
        new Map([[firstAudioUploadId, firstTranscript]]),
      );

      const response = await postMessage({
        messageContent: "Compare these",
        chosenModelId: modelId,
        audioUploadIds: [firstAudioUploadId, secondAudioUploadId],
      });

      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({
        message: "Transcript not found",
      });
      expect(mockChatAI).not.toHaveBeenCalled();
      expect(mockPersistChatTurn).not.toHaveBeenCalled();
      expect(mockReleaseConversationTurn).toHaveBeenCalledTimes(1);
    });

    it("refuses combined transcript content past the context budget", async () => {
      const oversizedTranscript = "x".repeat(MAX_CONTEXT_CHARS);
      mockFindTranscripts.mockResolvedValueOnce(
        new Map([[firstAudioUploadId, oversizedTranscript]]),
      );

      const response = await postMessage({
        messageContent: "Summarise this",
        chosenModelId: modelId,
        audioUploadIds: [firstAudioUploadId],
      });
      expect(response.status).toBe(413);
      expect(await response.json()).toEqual({
        message: "Transcripts are too long for one message",
        maxChars: MAX_CONTEXT_CHARS,
        chars: expect.any(Number),
      });
      expect(mockChatAI).not.toHaveBeenCalled();
      expect(mockReleaseConversationTurn).toHaveBeenCalledTimes(1);
    });

    it("charges all transcripts against the budget when admitting history", async () => {
      const long = "x".repeat(Math.floor(MAX_CONTEXT_CHARS / 3));
      const transcript = "y".repeat(MAX_CONTEXT_CHARS / 2);
      mockFindTranscripts.mockResolvedValueOnce(
        new Map([[firstAudioUploadId, transcript]]),
      );
      mockFindRecentMessagesWithContext.mockResolvedValueOnce([
        contextMessage({ role: "user", content: `newest ${long}` }),
        contextMessage({ role: "assistant", content: `middle ${long}` }),
      ]);
      mockChatAI.mockResolvedValueOnce("Hello world");

      const response = await postMessage({
        messageContent: "Summarise this",
        chosenModelId: modelId,
        audioUploadIds: [firstAudioUploadId],
      });
      expect(response.status).toBe(200);
      await response.text();

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
    expect(body).not.toContain("event: done");

    // The writes only run once a reply is known, so a failed turn saves nothing.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(mockPersistChatTurn).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledWith(
      userId,
      conversationId,
      "claim-token",
    );
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
    // The upload rides along on the turn's transactional write, to be claimed
    // by the user message it inserts.
    await vi.waitFor(() =>
      expect(mockPersistChatTurn).toHaveBeenCalledWith(
        expect.objectContaining({ attachmentUploadIds: [uploadId] }),
      ),
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
    expect(mockPersistChatTurn).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledTimes(1);
  });

  it("releases once and returns the first of multiple validation errors", async () => {
    const audioUploadId = "950e8400-e29b-41d4-a716-446655440444";
    mockResolveUnattachedImages.mockResolvedValueOnce([]);
    mockFindTranscripts.mockResolvedValueOnce(
      new Map([[audioUploadId, "x".repeat(MAX_CONTEXT_CHARS + 1)]]),
    );

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      attachmentUploadIds: [uploadId],
      audioUploadIds: [audioUploadId],
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Attachment not found" });
    expect(mockReleaseConversationTurn).toHaveBeenCalledTimes(1);
    expect(mockChatAI).not.toHaveBeenCalled();
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
    expect(mockPersistChatTurn).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation is not owned by the user", async () => {
    mockClaimConversationTurn.mockResolvedValueOnce(null);
    mockFindOwnedConversation.mockResolvedValueOnce(null);
    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(404);
    expect(mockPersistChatTurn).not.toHaveBeenCalled();
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
    expect(mockPersistChatTurn).not.toHaveBeenCalled();
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
    mockDeleteOwnedMessage.mockResolvedValueOnce({
      status: "deleted",
      id: messageId,
    });
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
    mockDeleteOwnedMessage.mockResolvedValueOnce({
      status: "deleted",
      id: messageId,
    });

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

  it("returns 409 without deleting files while a response is active", async () => {
    mockFindMessageImageUploadIds.mockResolvedValueOnce([uploadId]);
    mockDeleteOwnedMessage.mockResolvedValueOnce({ status: "active" });

    const res = await (
      await createApp()
    ).request(
      `http://localhost/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: { Cookie: await sessionCookieHeader(userId) },
      },
    );

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      message: "A response is already in progress",
    });
    expect(mockDeleteFilesFromBucket).not.toHaveBeenCalled();
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
