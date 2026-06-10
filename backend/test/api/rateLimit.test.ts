import { describe, it, expect, vi, beforeEach } from "vitest";
import { resetRateLimitMock } from "../helpers/rateLimitStoreMock";

const { mockLimit, mockWhere, mockFrom, mockSelect, mockGetUserIdFromCode } =
  vi.hoisted(() => ({
    mockLimit: vi.fn(),
    mockWhere: vi.fn(),
    mockFrom: vi.fn(),
    mockSelect: vi.fn(),
    mockGetUserIdFromCode: vi.fn(),
  }));

vi.mock("../../shared/db", () => ({
  db: { select: mockSelect },
  TextSummarizationJobs: { uploadId: "upload_id", userId: "user_id" },
  AudioTranscriptionJobs: { uploadId: "upload_id", userId: "user_id" },
}));

vi.mock("../../services/api/src/auth/auth", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../services/api/src/auth/auth")>();
  return {
    ...actual,
    getUserIdFromCode: mockGetUserIdFromCode,
  };
});

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";

const uploadId = "550e8400-e29b-41d4-a716-446655440000";

describe("rate limiting", () => {
  beforeEach(() => {
    resetRateLimitMock();
    vi.clearAllMocks();
    mockGetUserIdFromCode.mockRejectedValue(new Error("WorkOS unavailable"));
    mockWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
  });

  it("allows requests under the limit", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "notes.txt",
        status: "completed",
        summary: "A short summary.",
        error: null,
      },
    ]);
    const res = await createApp().request(`http://localhost/jobs/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.status).toBe(200);
  });

  it("returns RateLimit draft-6 headers on success", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "notes.txt",
        status: "completed",
        summary: "A short summary.",
        error: null,
      },
    ]);
    const res = await createApp().request(`http://localhost/jobs/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01") },
    });
    expect(res.headers.get("RateLimit-Limit")).toBe("100");
    expect(res.headers.get("RateLimit-Remaining")).toBeTruthy();
  });

  it("returns 429 when auth callback limit is exceeded", async () => {
    const app = createApp();
    for (let i = 0; i < 20; i++) {
      const res = await app.request(
        "http://localhost/auth/callback?code=test",
      );
      expect(res.status).not.toBe(429);
    }
    const res = await app.request("http://localhost/auth/callback?code=test");
    expect(res.status).toBe(429);
    expect(await res.json()).toEqual({
      message: "Too many requests, please try again later.",
    });
    expect(mockGetUserIdFromCode).toHaveBeenCalledTimes(20);
  });
});
