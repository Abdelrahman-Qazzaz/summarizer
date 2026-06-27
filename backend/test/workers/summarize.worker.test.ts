import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadId = "550e8400-e29b-41d4-a716-446655440000";

const { mockSendEvent, mockReturning, mockWhere, mockSet, mockUpdate } =
  vi.hoisted(() => {
    const mockReturning = vi.fn();
    const mockWhere = vi.fn();
    const mockSet = vi.fn();
    const mockUpdate = vi.fn();
    const mockSendEvent = vi.fn();
    return {
      mockSendEvent,
      mockReturning,
      mockWhere,
      mockSet,
      mockUpdate,
    };
  });

vi.mock("../../shared/bucket", () => ({
  readTextFile: vi.fn().mockResolvedValue("sample transcript text"),
}));
vi.mock("../../shared/ai/summarize", () => ({
  summarize: vi.fn().mockResolvedValue("sample summary"),
}));
vi.mock("../../shared/message-queue/messageQueue", () => ({
  mq: {
    queues: { SUMMARIZE_DONE: "summarize_done" },
    sendEvent: mockSendEvent,
  },
}));
vi.mock("../../shared/db", () => ({
  db: { update: mockUpdate },
  TextSummarizationJobs: {
    uploadId: "upload_id",
    userId: "user_id",
    status: "status",
  },
}));

import { readTextFile } from "../../shared/bucket";
import { summarize } from "../../shared/ai/summarize";
import { handleSummarizeJob } from "../../services/transcribe-summarize-service/workers/summarize.worker";
import { DEFAULT_MODELS } from "../../shared/ai/ai_client";

describe("handleSummarizeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    let updateCall = 0;
    mockReturning.mockResolvedValue([
      {
        uploadId,
        userId: "user_01",
        status: "queued",
        chosenModelId: DEFAULT_MODELS.PROMPT,
      },
    ]);
    mockWhere.mockImplementation(() => {
      updateCall += 1;
      if (updateCall === 1) {
        return { returning: mockReturning };
      }
      return Promise.resolve(undefined);
    });
    mockSet.mockImplementation(() => ({ where: mockWhere }));
    mockUpdate.mockImplementation(() => ({ set: mockSet }));
  });
  it("reads text, summarizes, and emits SUMMARIZE_DONE", async () => {
    mockReturning.mockResolvedValueOnce([
      {
        uploadId,
        userId: "user_01",
        status: "queued",
        chosenModelId: DEFAULT_MODELS.PROMPT,
      },
    ]);
    await handleSummarizeJob(uploadId);
    expect(readTextFile).toHaveBeenCalledWith(uploadId);
    expect(summarize).toHaveBeenCalledWith(
      DEFAULT_MODELS.PROMPT,
      "sample transcript text",
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockSendEvent).toHaveBeenCalledWith("summarize_done", {
      uploadId,
      userId: "user_01",
    });
  });
  it("no-ops when no queued job is claimed", async () => {
    mockReturning.mockResolvedValueOnce([]);
    await handleSummarizeJob(uploadId);
    expect(readTextFile).not.toHaveBeenCalled();
    expect(summarize).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });
});
