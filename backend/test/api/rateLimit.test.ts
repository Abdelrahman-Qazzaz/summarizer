import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  resetRateLimitMock,
  setRateLimitStoreUnavailable,
} from "../helpers/rateLimitStoreMock";

const {
  mockLimit,
  mockWhere,
  mockFrom,
  mockSelect,
  mockGetAuthSessionFromCode,
  mockgetChatModelData,
} = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
  mockGetAuthSessionFromCode: vi.fn(),
  mockgetChatModelData: vi.fn(),
}));

vi.mock("../../shared/db", async () => ({
  db: { select: mockSelect },
  ...(await import("../helpers/dbTableStubs")).tableStubs,
}));

vi.mock("../../api/src/auth/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../api/src/auth/auth")>();
  return {
    ...actual,
    getAuthSessionFromCode: mockGetAuthSessionFromCode,
  };
});

vi.mock("../../shared/ai/ai_chat_client", async (importActual) => {
  const actual =
    await importActual<typeof import("../../shared/ai/ai_chat_client")>();
  return {
    ...actual, // preserves DEFAULT_MODELS, used at upload.schema import time
    getChatModelData: mockgetChatModelData,
  };
});

import { createApp } from "../../api/app";
import { sessionCookieHeader } from "../helpers/session";

const uploadId = "550e8400-e29b-41d4-a716-446655440000";

describe("rate limiting", () => {
  beforeEach(() => {
    resetRateLimitMock();
    vi.clearAllMocks();
    mockGetAuthSessionFromCode.mockRejectedValue(
      new Error("WorkOS unavailable"),
    );
    mockgetChatModelData.mockResolvedValue({});
    mockWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockFrom.mockImplementation(() => ({
      leftJoin: () => ({ where: mockWhere }),
      where: mockWhere,
    }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
    // The transcript-view handler now reads the job and its transcript in
    // parallel; the second (transcript) read defaults to none unless overridden.
    mockLimit.mockResolvedValue([]);
  });

  it("allows requests under the limit", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "completed",
        error: null,
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/transcribe/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
  });

  it("returns RateLimit draft-6 headers on success", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "completed",
        transcriptUploadId: null,
        error: null,
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.headers.get("RateLimit-Limit")).toBe("100");
    expect(res.headers.get("RateLimit-Remaining")).toBeTruthy();
  });

  it("returns 429 when auth callback limit is exceeded", async () => {
    const app = await createApp();
    for (let i = 0; i < 20; i++) {
      const res = await app.request("http://localhost/auth/callback?code=test");
      expect(res.status).not.toBe(429);
    }
    const res = await app.request("http://localhost/auth/callback?code=test");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      message: "Too many requests, please try again later.",
    });
    expect(mockGetAuthSessionFromCode).toHaveBeenCalledTimes(20);
  });

  it("returns 503 when the rate limit store is unavailable", async () => {
    setRateLimitStoreUnavailable(true);
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "clip.mp3",
        status: "completed",
        transcriptUploadId: null,
        error: null,
      },
    ]);
    const res = await (
      await createApp()
    ).request(`http://localhost/jobs/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      message:
        "Rate limiting is temporarily unavailable. Please try again later.",
    });
  });
});

describe("GET /models rate limiting", () => {
  beforeEach(() => {
    resetRateLimitMock();
    vi.clearAllMocks();
    mockgetChatModelData.mockResolvedValue({});
  });

  it("returns 429 when model limit is exceeded", async () => {
    const app = await createApp();
    const cookie = await sessionCookieHeader("user_01");
    for (let i = 0; i < 100; i++) {
      const res = await app.request("http://localhost/models", {
        headers: { Cookie: cookie },
      });
      expect(res.status).not.toBe(429);
    }
    const res = await app.request("http://localhost/models", {
      headers: { Cookie: cookie },
    });
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      message: "Too many requests, please try again later.",
    });
  });

  it("returns 503 when the rate limit store is unavailable", async () => {
    setRateLimitStoreUnavailable(true);
    const res = await (
      await createApp()
    ).request("http://localhost/models", {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      message:
        "Rate limiting is temporarily unavailable. Please try again later.",
    });
  });
});
