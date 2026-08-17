import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetCache, mockSetCache, mockModelsList, mockChatSend } = vi.hoisted(
  () => ({
    mockGetCache: vi.fn(),
    mockSetCache: vi.fn(),
    mockModelsList: vi.fn(),
    mockChatSend: vi.fn(),
  }),
);

vi.mock("../../shared/cache/cache", () => ({
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
  chatAI,
  DEFAULT_CHAT_MODEL,
  getChatModelData,
  validateChatModelInput,
  validateChatModelOutput,
} from "../../shared/ai/ai_chat_client";

const sampleModelData = {
  [DEFAULT_CHAT_MODEL]: {
    id: DEFAULT_CHAT_MODEL,
    name: "GPT-4o Mini",
    description: "Fast chat model",
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
    expect(mockGetCache).toHaveBeenCalledWith("openRouterModels");
    expect(mockModelsList).not.toHaveBeenCalled();
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it("fetches, normalizes, and caches on cache miss", async () => {
    mockGetCache.mockResolvedValueOnce(null);
    mockModelsList.mockResolvedValueOnce({ data: [openRouterListModel] });

    const result = await getChatModelData();

    expect(result).toEqual(sampleModelData);
    expect(mockModelsList).toHaveBeenCalledTimes(1);
    // Only text-output models are relevant here; transcription is Deepgram's.
    expect(mockModelsList).toHaveBeenCalledWith({ outputModalities: "text" });
    expect(mockSetCache).toHaveBeenCalledWith(
      "openRouterModels",
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
    mockModelsList.mockResolvedValue({ data: [openRouterListModel] });

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
    mockModelsList.mockResolvedValue({ data: [openRouterListModel] });

    const result = await validateChatModelOutput("unknown/model", "text");

    expect(result).toBe(false);
    expect(mockModelsList).toHaveBeenCalled();
  });

  it("returns true for a known model id after fetch", async () => {
    mockGetCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue({ data: [openRouterListModel] });

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
    expect(mockChatSend).toHaveBeenCalledWith({
      chatRequest: expect.objectContaining({
        model: DEFAULT_CHAT_MODEL,
        maxCompletionTokens: 100,
        provider: { sort: "latency" },
        sessionId: "conversation-1",
      }),
    });
  });
});
