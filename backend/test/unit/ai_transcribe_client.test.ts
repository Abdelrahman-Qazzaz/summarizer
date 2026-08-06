import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockModelsList, mockCheckCache, mockSetCache } = vi.hoisted(() => ({
  mockModelsList: vi.fn(),
  mockCheckCache: vi.fn(),
  mockSetCache: vi.fn(),
}));

vi.mock("@deepgram/sdk", () => ({
  DeepgramClient: class {
    manage = { v1: { models: { list: mockModelsList } } };
    auth = { v1: { tokens: { grant: vi.fn() } } };
    listen = { v1: { media: { transcribeUrl: vi.fn() } } };
  },
}));

vi.mock("../../shared/redis", () => ({
  checkCache: mockCheckCache,
  setCache: mockSetCache,
}));

import {
  getTranscribeModelData,
  isValidTranscribeModel,
} from "../../shared/ai/ai_transcribe_client";

const sttResponse = {
  stt: [
    {
      name: "nova-3",
      canonical_name: "nova-3-general",
      architecture: "nova-3",
      languages: ["en"],
      version: "1",
      uuid: "u1",
      batch: true,
      streaming: true,
      formatted_output: true,
    },
    { name: "nova-2", canonical_name: "nova-2-general", uuid: "u2" },
  ],
};

describe("getTranscribeModelData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns the cached catalog without calling Deepgram", async () => {
    const cached = { "nova-3-general": { name: "nova-3" } };
    mockCheckCache.mockResolvedValue(cached);
    expect(await getTranscribeModelData()).toBe(cached);
    expect(mockModelsList).not.toHaveBeenCalled();
  });

  it("fetches from Deepgram on a miss, shapes the stt models, and caches", async () => {
    mockCheckCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue(sttResponse);

    const data = await getTranscribeModelData();

    expect(mockModelsList).toHaveBeenCalledTimes(1);
    // Keyed by canonical_name.
    expect(Object.keys(data)).toEqual(["nova-3-general", "nova-2-general"]);
    expect(data["nova-3-general"]).toMatchObject({
      name: "nova-3",
      canonicalName: "nova-3-general",
      formattedOutput: true,
    });
    expect(mockSetCache).toHaveBeenCalledWith(
      "transcribe-models:v1",
      data,
      expect.any(Number),
    );
  });
});

describe("isValidTranscribeModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCheckCache.mockResolvedValue(null);
    mockModelsList.mockResolvedValue(sttResponse);
  });

  it("accepts a model by its canonical_name", async () => {
    expect(await isValidTranscribeModel("nova-3-general")).toBe(true);
  });

  it("accepts a model by its display name", async () => {
    expect(await isValidTranscribeModel("nova-3")).toBe(true);
  });

  it("rejects a model that is not in the catalog", async () => {
    expect(await isValidTranscribeModel("whisper-large")).toBe(false);
  });
});
