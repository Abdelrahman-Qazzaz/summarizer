import { describe, it, expect, vi, beforeEach } from "vitest";

// Only hoist the mock function factory — no async work here
const { mockgetChatModelData, mockGetTranscribeModelData } = vi.hoisted(() => ({
  mockgetChatModelData: vi.fn(),
  mockGetTranscribeModelData: vi.fn(),
}));

vi.mock("../../shared/ai/ai_chat_client", async (importActual) => {
  // importActual is the correct way to get real values inside vi.mock
  const actual =
    await importActual<typeof import("../../shared/ai/ai_chat_client")>();
  return {
    ...actual, // preserves DEFAULT_MODELS and anything else
    getChatModelData: mockgetChatModelData, // override only what needs mocking
  };
});

vi.mock("../../shared/ai/ai_transcribe_client", async (importActual) => {
  const actual =
    await importActual<typeof import("../../shared/ai/ai_transcribe_client")>();
  return {
    ...actual,
    getTranscribeModelData: mockGetTranscribeModelData,
  };
});

vi.mock("../../shared/ai/ai_transcribe_client", async (importActual) => {
  const actual =
    await importActual<typeof import("../../shared/ai/ai_transcribe_client")>();
  return {
    ...actual,
    getTranscribeModelData: mockGetTranscribeModelData,
  };
});

// Now this import gets the mocked module, with real DEFAULT_MODELS intact

import { createApp } from "../../api/app";
import { sessionCookieHeader } from "../helpers/session";
import { DEFAULT_CHAT_MODEL } from "../../shared/ai/ai_chat_client";

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
  },
};

describe("GET /models/chat", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockgetChatModelData.mockResolvedValue(sampleModelData);
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/models/chat");
    expect(res.status).toBe(401);
    expect(mockgetChatModelData).not.toHaveBeenCalled();
  });

  it("returns modelData for a valid session", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/models/chat", {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ modelData: sampleModelData });
    expect(mockgetChatModelData).toHaveBeenCalledTimes(1);
  });

  it("gzips the catalog when the client accepts it", async () => {
    // The real catalog is ~335KB of JSON sent to every client; the sample here
    // only has to clear the middleware's 1KB threshold.
    mockgetChatModelData.mockResolvedValue(
      Object.fromEntries(
        Array.from({ length: 40 }, (_, index) => [
          `vendor/model-${index}`,
          sampleModelData[DEFAULT_CHAT_MODEL],
        ]),
      ),
    );

    const res = await (
      await createApp()
    ).request("http://localhost/models/chat", {
      headers: {
        Cookie: await sessionCookieHeader("user_01"),
        "Accept-Encoding": "gzip",
      },
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Encoding")).toBe("gzip");
  });

  it("returns RateLimit draft-6 headers on success", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/models/chat", {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("RateLimit-Limit")).toBe("100");
    expect(res.headers.get("RateLimit-Remaining")).toBeTruthy();
  });
});

const sampleTranscribeModelData = {
  "nova-3": {
    name: "nova-3",
    canonicalName: "nova-3-general",
    architecture: "nova-3",
    languages: ["en"],
    version: "2024-01-01",
    uuid: "abc-123",
    batch: true,
    streaming: true,
    formattedOutput: true,
  },
};

describe("GET /models/transcription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetTranscribeModelData.mockResolvedValue(sampleTranscribeModelData);
  });

  it("returns 401 without a session cookie", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/models/transcription");
    expect(res.status).toBe(401);
    expect(mockGetTranscribeModelData).not.toHaveBeenCalled();
  });

  it("returns transcriptionModelData for a valid session", async () => {
    const res = await (
      await createApp()
    ).request("http://localhost/models/transcription", {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      transcriptionModelData: sampleTranscribeModelData,
    });
    expect(mockGetTranscribeModelData).toHaveBeenCalledTimes(1);
  });
});
