import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { CACHE_KEYS } from "../../shared/cache/cacheKeys";
import { CLAIM_LEASE_MS } from "../../shared/data/conversations.data";

const { mockGetCache, mockSetCache, mockModelsList, mockChatSend } = vi.hoisted(
  () => ({
    mockGetCache: vi.fn(),
    mockSetCache: vi.fn(),
    mockModelsList: vi.fn(),
    mockChatSend: vi.fn(),
  }),
);

vi.mock("../../shared/cache/cache", () => ({
  CACHE_KEYS,
  getCache: mockGetCache,
  setCache: mockSetCache,
}));

vi.mock("@openrouter/sdk", () => ({
  OpenRouter: class {
    models = { list: mockModelsList };
    chat = { send: mockChatSend };
  },
}));

import {
  buildUserTurn,
  CHAT_BETWEEN_CHUNKS_TIMEOUT_MS,
  CHAT_FIRST_TOKEN_TIMEOUT_MS,
  CHAT_TOTAL_TIMEOUT_MS,
  chatAI,
  ChatTimeoutError,
  DEFAULT_CHAT_MODEL,
  generateTitle,
  getChatModelData,
  TITLE_TIMEOUT_MS,
  validateChatModelInput,
  validateChatModelOutput,
} from "../../shared/ai/ai_chat_client";

// The projection deliberately drops `description` — it is ~172KB of the
// catalog and nothing reads it. The OpenRouter fixture below still carries it,
// so this asserts the field is stripped rather than never supplied.
const sampleModelData = {
  [DEFAULT_CHAT_MODEL]: {
    id: DEFAULT_CHAT_MODEL,
    name: "GPT-4o Mini",
    knowledgeCutoff: null,
    topProvider: { contextLength: 128000, isModerated: true },
    pricing: { prompt: "0.00000015", completion: "0.0000006" },
    supportedParameters: ["temperature", "max_tokens"],
    outputModalities: ["text"],
    inputModalities: ["text", "image"],
  },
};

const openRouterListModel = {
  id: DEFAULT_CHAT_MODEL,
  name: "GPT-4o Mini",
  description: "Fast chat model",
  knowledgeCutoff: null,
  topProvider: { contextLength: 128000, isModerated: true },
  pricing: { prompt: "0.00000015", completion: "0.0000006" },
  supportedParameters: ["temperature", "max_tokens"],
  architecture: {
    outputModalities: ["text"],
    inputModalities: ["text", "image"],
    modality: "text",
  },
};

describe("getChatModelData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCache.mockResolvedValue(undefined);
  });

  it("returns cached data on cache hit without calling OpenRouter", async () => {
    mockGetCache.mockResolvedValueOnce(sampleModelData);

    const result = await getChatModelData();

    expect(result).toEqual(sampleModelData);
    expect(mockGetCache).toHaveBeenCalledWith(CACHE_KEYS.openRouterModels);
    expect(mockModelsList).not.toHaveBeenCalled();
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it("fetches, normalizes, and caches on cache miss", async () => {
    mockGetCache.mockResolvedValueOnce(null);
    mockModelsList.mockResolvedValueOnce({
      result: { data: [openRouterListModel] },
    });

    const result = await getChatModelData();

    expect(result).toEqual(sampleModelData);
    expect(mockModelsList).toHaveBeenCalledTimes(1);
    // Only text-output models are relevant here; transcription is Deepgram's.
    expect(mockModelsList).toHaveBeenCalledWith({ outputModalities: "text" });
    expect(mockSetCache).toHaveBeenCalledWith(
      CACHE_KEYS.openRouterModels,
      sampleModelData,
    );
  });
});

describe("validateChatModelInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCache.mockResolvedValue(undefined);
  });

  it("returns true for a modality the model accepts", async () => {
    mockGetCache.mockResolvedValueOnce(sampleModelData);

    expect(await validateChatModelInput(DEFAULT_CHAT_MODEL, "image")).toBe(
      true,
    );
  });

  it("returns false for a modality the model does not accept", async () => {
    mockGetCache.mockResolvedValueOnce(sampleModelData);

    expect(await validateChatModelInput(DEFAULT_CHAT_MODEL, "audio")).toBe(
      false,
    );
  });

  it("returns false for an unknown model id", async () => {
    mockGetCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue({
      result: { data: [openRouterListModel] },
    });

    expect(await validateChatModelInput("unknown/model", "image")).toBe(false);
  });
});

describe("buildUserTurn", () => {
  it("keeps a turn without images a plain string", () => {
    expect(buildUserTurn("Hi there")).toEqual({
      role: "user",
      content: "Hi there",
    });
  });

  it("puts the text first, then one part per image", () => {
    expect(
      buildUserTurn("What is this?", ["https://bucket.test/a.png"]),
    ).toEqual({
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        {
          type: "image_url",
          imageUrl: { url: "https://bucket.test/a.png" },
        },
      ],
    });
  });
});

describe("validateChatModelOutput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCache.mockResolvedValue(undefined);
  });

  it("returns true for a known model id from cache", async () => {
    mockGetCache.mockResolvedValueOnce(sampleModelData);

    const result = await validateChatModelOutput(DEFAULT_CHAT_MODEL, "text");

    expect(result).toBe(true);
    expect(mockModelsList).not.toHaveBeenCalled();
  });

  it("returns false for an unknown model id after fetch", async () => {
    mockGetCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue({
      result: { data: [openRouterListModel] },
    });

    const result = await validateChatModelOutput("unknown/model", "text");

    expect(result).toBe(false);
    expect(mockModelsList).toHaveBeenCalled();
  });

  it("returns true for a known model id after fetch", async () => {
    mockGetCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue({
      result: { data: [openRouterListModel] },
    });

    const result = await validateChatModelOutput(DEFAULT_CHAT_MODEL, "text");

    expect(result).toBe(true);
    expect(mockModelsList).toHaveBeenCalled();
  });

  it("returns false for a modality the model does not produce", async () => {
    mockGetCache.mockResolvedValueOnce(sampleModelData);

    expect(
      await validateChatModelOutput(DEFAULT_CHAT_MODEL, "transcription"),
    ).toBe(false);
  });
});

describe("chatAI", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("routes for low latency and pins the session for prompt-cache hits", async () => {
    mockChatSend.mockResolvedValueOnce({
      choices: [{ message: { content: "hi" } }],
    });

    const result = await chatAI(
      DEFAULT_CHAT_MODEL,
      [{ role: "user", content: "yo" }],
      { maxOutputTokens: 100, sessionId: "conversation-1" },
    );

    expect(result).toBe("hi");
    expect(mockChatSend).toHaveBeenCalledWith(
      {
        chatRequest: expect.objectContaining({
          model: DEFAULT_CHAT_MODEL,
          maxCompletionTokens: 100,
          provider: { sort: "latency" },
          sessionId: "conversation-1",
        }),
      },
      { signal: expect.any(AbortSignal) },
    );
  });
});

type SendOptions = { signal: AbortSignal };

/**
 * Waits `milliseconds` (forever when omitted), rejecting with the abort reason
 * once `signal` aborts — how the real SDK's request and stream behave. chatAI
 * relies on that, so a mock that ignored the signal would hide a regression.
 */
function abortableWait(signal: AbortSignal, milliseconds?: number) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const timer =
      milliseconds === undefined
        ? undefined
        : setTimeout(resolve, milliseconds);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

/** A send() that streams each chunk after its delay, then stalls (or ends, with `end`), like a provider sending only keep-alives. */
function streamingSend(
  chunks: { afterMs: number; content: string }[],
  { end = false } = {},
) {
  return async (_request: unknown, { signal }: SendOptions) =>
    (async function* () {
      for (const chunk of chunks) {
        await abortableWait(signal, chunk.afterMs);
        yield { choices: [{ delta: { content: chunk.content } }] };
      }
      if (!end) await abortableWait(signal);
    })();
}

function track(promise: Promise<unknown>) {
  const outcome: { settled: boolean; value?: unknown } = { settled: false };
  promise.then(
    (value) => Object.assign(outcome, { settled: true, value }),
    (error) => Object.assign(outcome, { settled: true, value: error }),
  );
  return outcome;
}

describe("chatAI timeouts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const streamChat = () =>
    chatAI(DEFAULT_CHAT_MODEL, [{ role: "user", content: "yo" }], {
      onDelta: () => {},
    });

  it("stays under the claim lease", () => {
    expect(CHAT_TOTAL_TIMEOUT_MS).toBeLessThan(CLAIM_LEASE_MS);
  });

  it("gives up when the stream goes quiet after the first token", async () => {
    mockChatSend.mockImplementationOnce(
      streamingSend([{ afterMs: 1_000, content: "hello" }]),
    );
    const outcome = track(streamChat());

    await vi.advanceTimersByTimeAsync(
      1_000 + CHAT_BETWEEN_CHUNKS_TIMEOUT_MS - 1,
    );
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.value).toBeInstanceOf(ChatTimeoutError);
  });

  it("waits longer for the first token than between chunks", async () => {
    mockChatSend.mockImplementationOnce(streamingSend([]));
    const outcome = track(streamChat());

    await vi.advanceTimersByTimeAsync(CHAT_FIRST_TOKEN_TIMEOUT_MS - 1);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.value).toBeInstanceOf(ChatTimeoutError);
  });

  it("keeps a slow but steady stream going", async () => {
    const chunks = Array.from({ length: 5 }, (_, index) => ({
      afterMs: CHAT_BETWEEN_CHUNKS_TIMEOUT_MS - 1_000,
      content: `t${index}`,
    }));
    const deltas: string[] = [];
    mockChatSend.mockImplementationOnce(streamingSend(chunks, { end: true }));
    const outcome = track(
      chatAI(DEFAULT_CHAT_MODEL, [{ role: "user", content: "yo" }], {
        onDelta: (delta) => {
          deltas.push(delta);
        },
      }),
    );

    await vi.advanceTimersByTimeAsync(5 * CHAT_BETWEEN_CHUNKS_TIMEOUT_MS);
    expect(outcome.value).toBe("t0t1t2t3t4");
    expect(deltas).toEqual(["t0", "t1", "t2", "t3", "t4"]);
  });

  it("ends a stream that never stops sending", async () => {
    mockChatSend.mockImplementationOnce(
      async (_request: unknown, { signal }: SendOptions) =>
        (async function* () {
          for (;;) {
            await abortableWait(signal, 10_000);
            yield { choices: [{ delta: { content: "." } }] };
          }
        })(),
    );
    const outcome = track(streamChat());

    await vi.advanceTimersByTimeAsync(CHAT_TOTAL_TIMEOUT_MS - 1);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.value).toBeInstanceOf(ChatTimeoutError);
  });

  it("gives up on a title that never arrives", async () => {
    mockChatSend.mockImplementationOnce(
      (_request: unknown, { signal }: SendOptions) => abortableWait(signal),
    );
    const outcome = track(generateTitle("conversation", "hello"));

    await vi.advanceTimersByTimeAsync(TITLE_TIMEOUT_MS - 1);
    expect(outcome.settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(outcome.value).toBeInstanceOf(ChatTimeoutError);
  });
});

describe("generateTitle", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("uses the default model and returns a trimmed title", async () => {
    mockChatSend.mockResolvedValueOnce({
      choices: [{ message: { content: "  Quarterly planning  " } }],
    });

    const title = await generateTitle(
      "conversation",
      "How should we organize the next quarter?",
    );

    expect(title).toBe("Quarterly planning");
    expect(mockChatSend).toHaveBeenCalledWith(
      {
        chatRequest: expect.objectContaining({
          model: DEFAULT_CHAT_MODEL,
          messages: [
            {
              role: "user",
              content: expect.stringContaining(
                "How should we organize the next quarter?",
              ),
            },
          ],
          maxCompletionTokens: 24,
        }),
      },
      { signal: expect.any(AbortSignal) },
    );
  });
});
