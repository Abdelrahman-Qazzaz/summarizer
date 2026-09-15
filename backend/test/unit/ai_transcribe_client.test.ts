import { describe, it, expect, vi, beforeEach } from "vitest";
import { CACHE_KEYS } from "../../shared/cache/cacheKeys";

const { mockModelsList, mockGetOrSetCache } = vi.hoisted(() => ({
  mockModelsList: vi.fn(),
  mockGetOrSetCache: vi.fn(),
}));

vi.mock("@deepgram/sdk", () => ({
  DeepgramClient: class {
    manage = { v1: { models: { list: mockModelsList } } };
    auth = { v1: { tokens: { grant: vi.fn() } } };
    listen = { v1: { media: { transcribeUrl: vi.fn() } } };
  },
}));

vi.mock("../../shared/cache/cache", () => ({
  CACHE_KEYS,
  getOrSetCache: mockGetOrSetCache,
}));

/** Caching itself is covered in cache.test.ts; here the fetch always runs. */
const runFetch = <T>(_name: unknown, fetch: () => Promise<T>) => fetch();

import {
  DEFAULT_TRANSCRIBE_MODEL,
  getTranscribeModelData,
  isValidTranscribeModel,
} from "../../shared/ai/ai_transcribe_client";

const sttResponse = {
  stt: [
    {
      name: "general",
      canonical_name: "nova-3-general",
      architecture: "nova-3",
      languages: ["en"],
      version: "1",
      uuid: "u1",
      batch: true,
      streaming: true,
      formatted_output: true,
    },
    { name: "general", canonical_name: "nova-2-general", uuid: "u2" },
  ],
};

describe("getTranscribeModelData", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("serves the catalog through its cache entry", async () => {
    const cached = { "nova-3-general": { name: "nova-3" } };
    mockGetOrSetCache.mockResolvedValue(cached);

    expect(await getTranscribeModelData()).toBe(cached);
    expect(mockGetOrSetCache).toHaveBeenCalledWith(
      CACHE_KEYS.deepgramTranscribeModels,
      expect.any(Function),
    );
    expect(mockModelsList).not.toHaveBeenCalled();
  });

  it("shapes the stt models it fetches from Deepgram", async () => {
    mockGetOrSetCache.mockImplementation(runFetch);
    mockModelsList.mockResolvedValue(sttResponse);

    const data = await getTranscribeModelData();

    expect(mockModelsList).toHaveBeenCalledTimes(1);
    // Keyed by canonical_name.
    expect(Object.keys(data)).toEqual(["nova-3-general", "nova-2-general"]);
    expect(data["nova-3-general"]).toMatchObject({
      name: "general",
      canonicalName: "nova-3-general",
      formattedOutput: true,
    });
  });
});

describe("isValidTranscribeModel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetOrSetCache.mockImplementation(runFetch);
    mockModelsList.mockResolvedValue(sttResponse);
  });

  it("accepts a model by its canonical_name", async () => {
    expect(await isValidTranscribeModel("nova-3-general")).toBe(true);
  });

  it("accepts a model by its display name", async () => {
    expect(await isValidTranscribeModel("general")).toBe(true);
  });

  it("accepts the default when display names differ from model IDs", async () => {
    expect(await isValidTranscribeModel(DEFAULT_TRANSCRIBE_MODEL)).toBe(true);
  });

  it("rejects a model that is not in the catalog", async () => {
    expect(await isValidTranscribeModel("whisper-large")).toBe(false);
  });
});
