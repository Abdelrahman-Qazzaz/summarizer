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

import { getModelData, validateModel } from "../../shared/ai/ai_client";

const sampleModelData = {
  "openai/gpt-4o-mini": {
    id: "openai/gpt-4o-mini",
    name: "GPT-4o Mini",
    description: "Fast chat model",
    knowledgeCutoff: null,
    topProvider: { contextLength: 128000, isModerated: true },
    pricing: { prompt: "0.00000015", completion: "0.0000006" },
    supportedParameters: ["temperature", "max_tokens"],
    outputModalities: ["text"],
  },
};

const openRouterListModel = {
  id: "openai/gpt-4o-mini",
  name: "GPT-4o Mini",
  description: "Fast chat model",
  knowledgeCutoff: null,
  topProvider: { contextLength: 128000, isModerated: true },
  pricing: { prompt: "0.00000015", completion: "0.0000006" },
  supportedParameters: ["temperature", "max_tokens"],
  architecture: {
    outputModalities: ["text"],
    inputModalities: ["text"],
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
    );
  });
});

describe("validateModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockSetCache.mockResolvedValue(undefined);
  });

  it("returns true for a known model id from cache", async () => {
    mockCheckCache.mockResolvedValueOnce(sampleModelData);

    const result = await validateModel("openai/gpt-4o-mini");

    expect(result).toBe(true);
    expect(mockModelsList).not.toHaveBeenCalled();
  });

  it("returns false for an unknown model id after fetch", async () => {
    mockCheckCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue({ data: [openRouterListModel] });

    const result = await validateModel("unknown/model");

    expect(result).toBe(false);
    expect(mockModelsList).toHaveBeenCalled();
  });

  it("returns true for a known model id after fetch", async () => {
    mockCheckCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue({ data: [openRouterListModel] });

    const result = await validateModel("openai/gpt-4o-mini");

    expect(result).toBe(true);
    expect(mockModelsList).toHaveBeenCalled();
  });
});
