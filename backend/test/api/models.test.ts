import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockGetModelData } = vi.hoisted(() => ({
  mockGetModelData: vi.fn(),
}));

vi.mock("../../shared/ai/ai_client", () => ({
  getModelData: mockGetModelData,
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";

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
