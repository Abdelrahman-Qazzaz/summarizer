import { describe, it, expect, vi, beforeEach } from "vitest";
const { mockLimit, mockWhere, mockFrom, mockSelect } = vi.hoisted(() => ({
  mockLimit: vi.fn(),
  mockWhere: vi.fn(),
  mockFrom: vi.fn(),
  mockSelect: vi.fn(),
}));

vi.mock("../../shared/db", () => ({
  db: { select: mockSelect },
  TextSummarizationJobs: { uploadId: "upload_id", userId: "user_id" },
  AudioTranscriptionJobs: { uploadId: "upload_id", userId: "user_id" },
}));

import { createApp } from "../../services/api/app";
import { sessionCookieHeader } from "../helpers/session";
const uploadId = "550e8400-e29b-41d4-a716-446655440000";

describe("GET /jobs/:uploadId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockWhere.mockImplementation(() => ({ limit: mockLimit }));
    mockFrom.mockImplementation(() => ({ where: mockWhere }));
    mockSelect.mockImplementation(() => ({ from: mockFrom }));
  });
  it("returns 401 without a session cookie", async () => {
    const res = await createApp().request(`http://localhost/jobs/${uploadId}`);
    expect(res.status).toBe(401);
    expect(mockSelect).not.toHaveBeenCalled();
  });
  it("returns a text job for the owner", async () => {
    mockLimit.mockResolvedValueOnce([
      {
        uploadId,
        fileName: "notes.txt",
        status: "completed",
        summary: "A short summary.",
        error: null,
      },
    ]);
    const userId = "user_01OWNER";
    const res = await createApp().request(`http://localhost/jobs/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader(userId) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "text",
      uploadId,
      fileName: "notes.txt",
      status: "completed",
      summary: "A short summary.",
      error: null,
    });
    expect(mockSelect).toHaveBeenCalledTimes(1);
  });
  it("returns an audio job when no text job exists", async () => {
    mockLimit
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([
        {
          uploadId,
          fileName: "clip.mp3",
          status: "processing",
          error: null,
        },
      ]);
    const userId = "user_01OWNER";
    const res = await createApp().request(`http://localhost/jobs/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader(userId) },
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      kind: "audio",
      uploadId,
      fileName: "clip.mp3",
      status: "processing",
      error: null,
    });
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
  it("returns 404 when no job exists for the user", async () => {
    mockLimit.mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const res = await createApp().request(`http://localhost/jobs/${uploadId}`, {
      headers: { Cookie: await sessionCookieHeader("user_01OTHER") },
    });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ message: "Job not found" });
    expect(mockSelect).toHaveBeenCalledTimes(2);
  });
});
