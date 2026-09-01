import { describe, it, expect, vi, beforeEach } from "vitest";

const {
  mockFindOwnedConversation,
  mockClaimConversationTurn,
  mockReleaseConversationTurn,
  mockFindCreateMessageHistory,
  mockFindMessagePatchContext,
  mockPersistChatTurn,
  mockPersistAssistantMessage,
  mockPatchOwnedUserMessage,
  mockFindConversationMessages,
  mockDeleteOwnedMessage,
  mockResolveImages,
  mockResolveMessageImages,
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
  mockFindCreateMessageHistory: vi.fn(),
  mockFindMessagePatchContext: vi.fn(),
  mockPersistChatTurn: vi.fn(),
  mockPersistAssistantMessage: vi.fn(),
  mockPatchOwnedUserMessage: vi.fn(),
  mockFindConversationMessages: vi.fn(),
  mockDeleteOwnedMessage: vi.fn(),
  mockResolveImages: vi.fn(),
  mockResolveMessageImages: vi.fn(),
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
// join queries behind the history loaders are a data-layer concern. The
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
  findCreateMessageHistory: mockFindCreateMessageHistory,
  findMessagePatchContext: mockFindMessagePatchContext,
  persistChatTurn: mockPersistChatTurn,
  persistAssistantMessage: mockPersistAssistantMessage,
  patchOwnedUserMessage: mockPatchOwnedUserMessage,
  findConversationMessages: mockFindConversationMessages,
  deleteOwnedMessage: mockDeleteOwnedMessage,
}));

vi.mock("../../api/src/data/images.data", async (importActual) => ({
  ...(await importActual<typeof import("../../api/src/data/images.data")>()),
  resolveImages: mockResolveImages,
  resolveMessageImages: mockResolveMessageImages,
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
import { authedHeaders, sessionCookieHeader } from "../helpers/session";
import type {
  ContextMessage,
  CreateMessageHistory,
} from "../../api/src/data/messages.data";

const conversationId = "550e8400-e29b-41d4-a716-446655440000";
const messageId = "650e8400-e29b-41d4-a716-446655440111";
const userId = "user_01OWNER";
const modelId = "openai/gpt-4o-mini";
const createdAt = "2026-07-22T00:00:00.000Z";

const imageUploadId = "850e8400-e29b-41d4-a716-446655440333";

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
  imageUploadId,
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

function createMessageHistory(
  partial: Partial<CreateMessageHistory> = {},
): CreateMessageHistory {
  const content = partial.content ?? "";
  const transcriptContents = partial.transcriptContents ?? [];
  return {
    id: messageId,
    role: "user",
    createdAt: new Date(createdAt),
    imageUrls: [],
    ...partial,
    content,
    transcriptContents,
    contextCharCount:
      partial.contextCharCount ??
      content.length +
        transcriptContents.reduce(
          (total, transcript) => total + transcript.length,
          0,
        ),
  };
}

function messageRequestBody(body: unknown) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const {
    imageUploadIds = [],
    audioUploadIds = [],
    ...requestBody
  } = body as {
    imageUploadIds?: string[];
    audioUploadIds?: string[];
  } & Record<string, unknown>;

  return {
    ...requestBody,
    attachments: [
      ...imageUploadIds.map((imageUploadId) => ({
        type: "image",
        imageUploadId,
      })),
      ...audioUploadIds.map((audioUploadId) => ({
        type: "transcript",
        audioUploadId,
      })),
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockFindOwnedConversation.mockResolvedValue(ownedConversation);
  mockClaimConversationTurn.mockResolvedValue("claim-token");
  mockReleaseConversationTurn.mockResolvedValue(undefined);
  mockFindCreateMessageHistory.mockResolvedValue([]);
  mockFindMessagePatchContext.mockResolvedValue({
    target: { id: messageId, role: "user", createdAt: new Date(createdAt) },
    history: [],
  });
  mockResolveImages.mockResolvedValue([]);
  mockResolveMessageImages.mockResolvedValue(new Map());
  mockResolveImageUploadUrls.mockResolvedValue(new Map());
  mockFindMessageTranscriptAttachments.mockResolvedValue(new Map());
  mockFindTranscripts.mockResolvedValue(new Map());
  mockPersistChatTurn.mockResolvedValue(assistantRow.id);
  mockPersistAssistantMessage.mockResolvedValue(assistantRow.id);
  mockPatchOwnedUserMessage.mockResolvedValue({
    status: "patched",
    imageUploadIds: [],
  });
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
      headers: await authedHeaders(userId),
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
              imageUploadId: "950e8400-e29b-41d4-a716-446655440444",
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
      headers: await authedHeaders(userId),
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
              imageUploadId: "950e8400-e29b-41d4-a716-446655440444",
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
      headers: await authedHeaders(userId),
    });
    expect(res.status).toBe(404);
  });
});

describe("POST /conversations/:conversationId/messages", () => {
  function postMessage(body: unknown, signal?: AbortSignal) {
    const requestBody =
      body && typeof body === "object" && !Array.isArray(body)
        ? messageRequestBody({ lastMessageId: null, ...body })
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
      expect(mockResolveImages).toHaveBeenCalled();
      expect(mockFindCreateMessageHistory).toHaveBeenCalled();
    });

    resolveClaim("claim-token");
    const res = await responsePromise;
    expect(res.status).toBe(200);
    await res.text();
  });

  it("releases an acquired claim when a context read fails", async () => {
    mockFindCreateMessageHistory.mockRejectedValueOnce(
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
        contextWindowMessageCount: 2,
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
    mockFindCreateMessageHistory.mockResolvedValueOnce([
      // History arrives newest-first from the query; the controller reverses it.
      createMessageHistory({
        id: assistantRow.id,
        role: "assistant",
        content: "Old answer",
      }),
      createMessageHistory({
        id: messageId,
        role: "user",
        content: "Old question",
      }),
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

  it("trims resolved transcript history against the final budget", async () => {
    mockFindCreateMessageHistory.mockResolvedValueOnce([
      createMessageHistory({
        id: assistantRow.id,
        content: "Newer",
        transcriptContents: ["T"],
        contextCharCount: 15,
      }),
      createMessageHistory({
        id: messageId,
        content: "Older",
        transcriptContents: ["unused body"],
        contextCharCount: MAX_CONTEXT_CHARS,
      }),
    ]);
    mockChatAI.mockResolvedValueOnce("Hello world");

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
    });
    expect(res.status).toBe(200);
    await res.text();

    expect(mockFindTranscripts).toHaveBeenCalledOnce();
    expect(mockFindTranscripts).toHaveBeenCalledWith(userId, []);
    const [, turns] = mockChatAI.mock.calls[0];
    expect(turns).toHaveLength(2);
  });

  it("replays images a past turn was sent with", async () => {
    mockFindCreateMessageHistory.mockResolvedValueOnce([
      createMessageHistory({
        id: messageId,
        role: "user",
        content: "What is this?",
        imageUrls: [resolvedImage.url],
      }),
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
    mockFindCreateMessageHistory.mockResolvedValueOnce([
      createMessageHistory({
        id: messageId,
        role: "user",
        content: "What is this?",
        imageUrls: [resolvedImage.url],
      }),
    ]);
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
    mockFindCreateMessageHistory.mockResolvedValueOnce([
      createMessageHistory({ role: "user", content: `newest ${long}` }),
      createMessageHistory({ role: "assistant", content: `middle ${long}` }),
      createMessageHistory({ role: "user", content: `oldest ${long}` }),
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
    expect(mockPersistChatTurn).toHaveBeenCalledWith(
      expect.objectContaining({ contextWindowMessageCount: 4 }),
    );
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
            attachmentUploadIds: [firstAudioUploadId, secondAudioUploadId],
          }),
        ),
      );
      expect(mockFindTranscripts).toHaveBeenCalledWith(userId, [
        firstAudioUploadId,
        secondAudioUploadId,
      ]);
    });

    it("replays all transcripts from a past turn", async () => {
      mockFindCreateMessageHistory.mockResolvedValueOnce([
        createMessageHistory({
          id: messageId,
          role: "user",
          content: "Compare these",
          transcriptContents: [firstTranscript, secondTranscript],
        }),
      ]);
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
      mockFindCreateMessageHistory.mockResolvedValueOnce([
        createMessageHistory({ role: "user", content: `newest ${long}` }),
        createMessageHistory({ role: "assistant", content: `middle ${long}` }),
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
    mockResolveImages.mockResolvedValueOnce([resolvedImage]);
    mockChatAI.mockResolvedValueOnce("Hello world");

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      imageUploadIds: [imageUploadId],
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
        expect.objectContaining({ attachmentUploadIds: [imageUploadId] }),
      ),
    );
  });

  it("rejects an attachment that is not the user's, or already sent", async () => {
    mockResolveImages.mockResolvedValueOnce([]);

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      imageUploadIds: [imageUploadId],
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Attachment not found" });
    expect(mockPersistChatTurn).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledTimes(1);
  });

  it("releases once and returns the first of multiple validation errors", async () => {
    const audioUploadId = "950e8400-e29b-41d4-a716-446655440444";
    mockResolveImages.mockResolvedValueOnce([]);
    mockFindTranscripts.mockResolvedValueOnce(
      new Map([[audioUploadId, "x".repeat(MAX_CONTEXT_CHARS + 1)]]),
    );

    const res = await postMessage({
      messageContent: "Hi there",
      chosenModelId: modelId,
      imageUploadIds: [imageUploadId],
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
      imageUploadIds: [imageUploadId],
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

describe("PATCH /conversations/:conversationId/messages/:messageId", () => {
  const audioUploadId = "950e8400-e29b-41d4-a716-446655440444";

  function patchMessage(body: unknown) {
    return sessionCookieHeader(userId).then(async (cookie) =>
      (await createApp()).request(
        `http://localhost/conversations/${conversationId}/messages/${messageId}`,
        {
          method: "PATCH",
          headers: { Cookie: cookie, "Content-Type": "application/json" },
          body: JSON.stringify(messageRequestBody(body)),
        },
      ),
    );
  }

  it("rewinds, replaces the complete user turn, and streams a new answer", async () => {
    mockFindMessagePatchContext.mockResolvedValueOnce({
      target: { id: messageId, role: "user", createdAt: new Date(createdAt) },
      history: [
        contextMessage({
          id: assistantRow.id,
          role: "assistant",
          content: "Earlier answer",
        }),
        contextMessage({
          id: "450e8400-e29b-41d4-a716-446655440999",
          role: "user",
          content: "Earlier question",
        }),
      ],
    });
    mockResolveImages.mockResolvedValueOnce([resolvedImage]);
    mockFindTranscripts.mockResolvedValueOnce(
      new Map([[audioUploadId, "Edited transcript"]]),
    );
    mockPatchOwnedUserMessage.mockResolvedValueOnce({
      status: "patched",
      imageUploadIds: ["old-image"],
    });
    mockChatAI.mockImplementationOnce(
      async (
        _model: string,
        _turns: unknown,
        options: { onDelta: (delta: string) => void | Promise<void> },
      ) => {
        await options.onDelta("Replacement answer");
        return "Replacement answer";
      },
    );

    const response = await patchMessage({
      messageContent: "Updated question",
      chosenModelId: modelId,
      imageUploadIds: [imageUploadId],
      audioUploadIds: [audioUploadId],
      lastMessageId: assistantRow.id,
    });
    const body = await response.text();

    expect(response.status).toBe(200);
    expect(body).toContain("event: delta");
    expect(body).toContain(JSON.stringify({ lastMessageId: assistantRow.id }));
    expect(mockClaimConversationTurn).toHaveBeenCalledWith(
      userId,
      conversationId,
      assistantRow.id,
    );
    expect(mockPatchOwnedUserMessage).toHaveBeenCalledWith({
      userId,
      conversationId,
      messageId,
      content: "Updated question",
      attachmentUploadIds: [imageUploadId, audioUploadId],
      claimToken: "claim-token",
    });
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith(userId, [
      "old-image",
    ]);
    expect(mockChatAI).toHaveBeenCalledWith(
      modelId,
      [
        { role: "user", content: "Earlier question" },
        { role: "assistant", content: "Earlier answer" },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: "Edited transcript\n\nUpdated question",
            },
            { type: "image_url", imageUrl: { url: resolvedImage.url } },
          ],
        },
      ],
      expect.objectContaining({ onDelta: expect.any(Function) }),
    );
    expect(mockPersistAssistantMessage).toHaveBeenCalledWith({
      userId,
      conversationId,
      chosenModelId: modelId,
      assistantContent: "Replacement answer",
      claimToken: "claim-token",
    });
  });

  it("keeps the edited prompt and releases its claim when generation fails", async () => {
    mockChatAI.mockRejectedValueOnce(new Error("provider unavailable"));

    const response = await patchMessage({
      messageContent: "Updated question",
      chosenModelId: modelId,
      imageUploadIds: [],
      audioUploadIds: [],
      lastMessageId: assistantRow.id,
    });

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("event: error");
    expect(mockPatchOwnedUserMessage).toHaveBeenCalledOnce();
    expect(mockPersistAssistantMessage).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledWith(
      userId,
      conversationId,
      "claim-token",
    );
  });

  it("rejects assistant-message edits before rewinding", async () => {
    mockFindMessagePatchContext.mockResolvedValueOnce({
      target: {
        id: assistantRow.id,
        role: "assistant",
        createdAt: new Date(createdAt),
      },
      history: [],
    });

    const response = await patchMessage({
      messageContent: "Updated answer",
      chosenModelId: modelId,
      imageUploadIds: [],
      audioUploadIds: [],
      lastMessageId: assistantRow.id,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      message: "Only user messages can be edited",
    });
    expect(mockPatchOwnedUserMessage).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledOnce();
  });

  it("returns 404 and releases the claim when the message is unavailable", async () => {
    mockFindMessagePatchContext.mockResolvedValueOnce(null);

    const response = await patchMessage({
      messageContent: "Updated question",
      chosenModelId: modelId,
      imageUploadIds: [],
      audioUploadIds: [],
      lastMessageId: assistantRow.id,
    });

    expect(response.status).toBe(404);
    expect(mockPatchOwnedUserMessage).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledOnce();
  });

  it("returns 409 when the submitted conversation head is stale", async () => {
    mockClaimConversationTurn.mockResolvedValueOnce(null);

    const response = await patchMessage({
      messageContent: "Updated question",
      chosenModelId: modelId,
      imageUploadIds: [],
      audioUploadIds: [],
      lastMessageId: messageId,
    });

    expect(response.status).toBe(409);
    expect(mockPatchOwnedUserMessage).not.toHaveBeenCalled();
  });

  it("returns 404 when the conversation is unavailable", async () => {
    mockClaimConversationTurn.mockResolvedValueOnce(null);
    mockFindOwnedConversation.mockResolvedValueOnce(null);

    const response = await patchMessage({
      messageContent: "Updated question",
      chosenModelId: modelId,
      imageUploadIds: [],
      audioUploadIds: [],
      lastMessageId: assistantRow.id,
    });

    expect(response.status).toBe(404);
    expect(mockPatchOwnedUserMessage).not.toHaveBeenCalled();
  });

  it("does not rewind when an exact attachment id is unavailable", async () => {
    mockResolveImages.mockResolvedValueOnce([]);

    const response = await patchMessage({
      messageContent: "Updated question",
      chosenModelId: modelId,
      imageUploadIds: [imageUploadId],
      audioUploadIds: [],
      lastMessageId: assistantRow.id,
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ message: "Attachment not found" });
    expect(mockPatchOwnedUserMessage).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledOnce();
  });

  it("does not rewind when retained history needs image input", async () => {
    mockFindMessagePatchContext.mockResolvedValueOnce({
      target: { id: messageId, role: "user", createdAt: new Date(createdAt) },
      history: [
        contextMessage({
          images: [
            {
              imageUploadId,
              signedUrl: null,
              signedUrlExpiresAt: null,
            },
          ],
        }),
      ],
    });
    mockResolveImageUploadUrls.mockResolvedValueOnce(
      new Map([[imageUploadId, resolvedImage.url]]),
    );
    mockValidateModelInput.mockResolvedValueOnce(false);

    const response = await patchMessage({
      messageContent: "Updated question",
      chosenModelId: modelId,
      imageUploadIds: [],
      audioUploadIds: [],
      lastMessageId: assistantRow.id,
    });

    expect(response.status).toBe(400);
    expect(mockPatchOwnedUserMessage).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledOnce();
  });

  it("does not rewind when the edited turn exceeds the context budget", async () => {
    mockFindTranscripts.mockResolvedValueOnce(
      new Map([[audioUploadId, "x".repeat(MAX_CONTEXT_CHARS)]]),
    );

    const response = await patchMessage({
      messageContent: "Updated question",
      chosenModelId: modelId,
      imageUploadIds: [],
      audioUploadIds: [audioUploadId],
      lastMessageId: assistantRow.id,
    });

    expect(response.status).toBe(413);
    expect(mockPatchOwnedUserMessage).not.toHaveBeenCalled();
    expect(mockReleaseConversationTurn).toHaveBeenCalledOnce();
  });
});

describe("DELETE /conversations/:conversationId/messages/:messageId", () => {
  it("deletes the message", async () => {
    mockDeleteOwnedMessage.mockResolvedValueOnce({
      status: "deleted",
      ids: [messageId],
      imageUploadIds: [],
      lastMessageId: null,
    });
    const res = await (
      await createApp()
    ).request(
      `http://localhost/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: await authedHeaders(userId),
      },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ message: "Message deleted" });
  });

  it("removes the message's images from the bucket", async () => {
    mockDeleteOwnedMessage.mockResolvedValueOnce({
      status: "deleted",
      ids: [messageId, assistantRow.id],
      imageUploadIds: [imageUploadId, "another-upload"],
      lastMessageId: null,
    });

    const res = await (
      await createApp()
    ).request(
      `http://localhost/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: await authedHeaders(userId),
      },
    );

    expect(res.status).toBe(200);
    expect(mockDeleteFilesFromBucket).toHaveBeenCalledWith(userId, [
      imageUploadId,
      "another-upload",
    ]);
  });

  it("returns 404 when the message does not exist for the user", async () => {
    mockDeleteOwnedMessage.mockResolvedValueOnce(null);
    const res = await (
      await createApp()
    ).request(
      `http://localhost/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: await authedHeaders(userId),
      },
    );
    expect(res.status).toBe(404);
  });

  it("returns 409 without deleting files while a response is active", async () => {
    mockDeleteOwnedMessage.mockResolvedValueOnce({ status: "active" });

    const res = await (
      await createApp()
    ).request(
      `http://localhost/conversations/${conversationId}/messages/${messageId}`,
      {
        method: "DELETE",
        headers: await authedHeaders(userId),
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
        headers: await authedHeaders(userId),
      },
    );
    expect(res.status).toBe(400);
    expect(mockDeleteOwnedMessage).not.toHaveBeenCalled();
  });
});
