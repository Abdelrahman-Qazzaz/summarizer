import { describe, it, expect, vi, beforeEach } from "vitest";
import { CACHE_KEYS } from "../../shared/keys";

const { mockCheckCache, mockSetCache, mockModelsList } = vi.hoisted(() => ({
  mockCheckCache: vi.fn(),
  mockSetCache: vi.fn(),
  mockModelsList: vi.fn(),
}));

vi.mock("../../shared/redis", () => ({
  checkCache: mockCheckCache,
  setCache: mockSetCache,
}));

vi.mock("@openrouter/sdk", () => ({
  OpenRouter: class {
    models = { list: mockModelsList };
  },
}));

import {
  buildUserTurn,
  DEFAULT_CHAT_MODEL,
  getModelData,
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

describe("getModelData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCache.mockResolvedValue(undefined);
  });

  it("returns cached data on cache hit without calling OpenRouter", async () => {
    mockCheckCache.mockResolvedValueOnce(sampleModelData);

    const result = await getModelData();

    expect(result).toEqual(sampleModelData);
    expect(mockCheckCache).toHaveBeenCalledWith(CACHE_KEYS.openRouterModels);
    expect(mockModelsList).not.toHaveBeenCalled();
    expect(mockSetCache).not.toHaveBeenCalled();
  });

  it("fetches, normalizes, and caches on cache miss", async () => {
    mockCheckCache.mockResolvedValueOnce(null);
    mockModelsList.mockResolvedValueOnce({ data: [openRouterListModel] });

    const result = await getModelData();

    expect(result).toEqual(sampleModelData);
    expect(mockModelsList).toHaveBeenCalledTimes(1);
    expect(mockSetCache).toHaveBeenCalledWith(
      CACHE_KEYS.openRouterModels,
      sampleModelData,
      expect.any(Number), // the catalog's ttl
    );
  });
});

describe("validateChatModelInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCache.mockResolvedValue(undefined);
  });

  it("returns true for a modality the model accepts", async () => {
    mockCheckCache.mockResolvedValueOnce(sampleModelData);

    expect(await validateChatModelInput(DEFAULT_CHAT_MODEL, "image")).toBe(
      true,
    );
  });

  it("returns false for a modality the model does not accept", async () => {
    mockCheckCache.mockResolvedValueOnce(sampleModelData);

    expect(await validateChatModelInput(DEFAULT_CHAT_MODEL, "audio")).toBe(
      false,
    );
  });

  it("returns false for an unknown model id", async () => {
    mockCheckCache.mockResolvedValue(null);
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
    mockCheckCache.mockResolvedValueOnce(sampleModelData);

    const result = await validateChatModelOutput(DEFAULT_CHAT_MODEL, "text");

    expect(result).toBe(true);
    expect(mockModelsList).not.toHaveBeenCalled();
  });

  it("returns false for an unknown model id after fetch", async () => {
    mockCheckCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue({ data: [openRouterListModel] });

    const result = await validateChatModelOutput("unknown/model", "text");

    expect(result).toBe(false);
    expect(mockModelsList).toHaveBeenCalled();
  });

  it("returns true for a known model id after fetch", async () => {
    mockCheckCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue({ data: [openRouterListModel] });

    const result = await validateChatModelOutput(DEFAULT_CHAT_MODEL, "text");

    expect(result).toBe(true);
    expect(mockModelsList).toHaveBeenCalled();
  });

  it("returns false for a modality the model does not produce", async () => {
    mockCheckCache.mockResolvedValueOnce(sampleModelData);

    expect(
      await validateChatModelOutput(DEFAULT_CHAT_MODEL, "transcription"),
    ).toBe(false);
  });
});
