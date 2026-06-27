import { describe, it, expect, vi, beforeEach } from "vitest";

// Only hoist the mock function factory — no async work here
const { mockGetModelData } = vi.hoisted(() => ({
  mockGetModelData: vi.fn(),
}));

vi.mock("../../shared/ai/ai_client", async (importActual) => {
  // importActual is the correct way to get real values inside vi.mock
  const actual =
    await importActual<typeof import("../../shared/ai/ai_client")>();
  return {
    ...actual, // preserves DEFAULT_MODELS and anything else
    getModelData: mockGetModelData, // override only what needs mocking
  };
});

// Now this import gets the mocked module, with real DEFAULT_MODELS intact
import { DEFAULT_MODELS } from "../../shared/ai/ai_client";
import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";

const sampleModelData = {
  [DEFAULT_MODELS.PROMPT]: {
    id: DEFAULT_MODELS.PROMPT,
    name: "GPT-4o Mini",
    description: "Fast chat model",
    knowledgeCutoff: null,
    topProvider: { contextLength: 128000, isModerated: true },
    pricing: { prompt: "0.00000015", completion: "0.0000006" },
    supportedParameters: ["temperature", "max_tokens"],
    outputModalities: ["text"],
  },
};

describe("GET /models", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetModelData.mockResolvedValue(sampleModelData);
  });

  it("returns 401 without a session cookie", async () => {
    const res = await createApp().request("http://localhost/models");
    expect(res.status).toBe(401);
    expect(mockGetModelData).not.toHaveBeenCalled();
  });

  it("returns modelData for a valid session", async () => {
    const res = await createApp().request("http://localhost/models", {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ modelData: sampleModelData });
    expect(mockGetModelData).toHaveBeenCalledTimes(1);
  });

  it("returns RateLimit draft-6 headers on success", async () => {
    const res = await createApp().request("http://localhost/models", {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("RateLimit-Limit")).toBe("100");
    expect(res.headers.get("RateLimit-Remaining")).toBeTruthy();
  });
});
