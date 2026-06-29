import { describe, it, expect, vi, beforeEach } from "vitest";

const uploadId = "550e8400-e29b-41d4-a716-446655440000";

const { mockSendEvent, mockPromptAI, mockReturning, mockWhere, mockSet, mockUpdate } =
  vi.hoisted(() => {
    const mockReturning = vi.fn();
    const mockWhere = vi.fn();
    const mockSet = vi.fn();
    const mockUpdate = vi.fn();
    const mockSendEvent = vi.fn();
    const mockPromptAI = vi.fn();
    return {
      mockSendEvent,
      mockPromptAI,
      mockReturning,
      mockWhere,
      mockSet,
      mockUpdate,
    };
  });

vi.mock("../../shared/bucket", () => ({
  readTextFile: vi.fn().mockResolvedValue("sample transcript text"),
}));
vi.mock("../../shared/ai/ai_client", () => ({
  promptAI: mockPromptAI,
  DEFAULT_MODELS: { TRANSCRIBE: "transcribe-model", PROMPT: "prompt-model" },
}));
vi.mock("../../shared/message-queue/messageQueue", () => ({
  mq: {
    queues: {
      SUMMARIZE_CHUNK: "summarize_chunk",
      SUMMARIZE_DONE: "summarize_done",
    },
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
import { handleSummarizeJob } from "../../services/transcribe-summarize-service/workers/summarize.worker";
import { DEFAULT_MODELS } from "../../shared/ai/ai_client";

describe("handleSummarizeJob", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Stream a single delta, then resolve the full summary string.
    mockPromptAI.mockImplementation(
      async (_model: string, _prompt: string, opts?: { onDelta?: (d: string) => void }) => {
        opts?.onDelta?.("sample summary");
        return "sample summary";
      },
    );
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
  it("reads text, streams chunks, and emits SUMMARIZE_DONE", async () => {
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
    expect(mockPromptAI).toHaveBeenCalledWith(
      DEFAULT_MODELS.PROMPT,
      expect.stringContaining("sample transcript text"),
      expect.objectContaining({ onDelta: expect.any(Function) }),
    );
    expect(mockUpdate).toHaveBeenCalledTimes(2);
    expect(mockSendEvent).toHaveBeenCalledWith("summarize_chunk", {
      uploadId,
      userId: "user_01",
      delta: "sample summary",
    });
    expect(mockSendEvent).toHaveBeenCalledWith("summarize_done", {
      uploadId,
      userId: "user_01",
    });
  });
  it("no-ops when no queued job is claimed", async () => {
    mockReturning.mockResolvedValueOnce([]);
    await handleSummarizeJob(uploadId);
    expect(readTextFile).not.toHaveBeenCalled();
    expect(mockPromptAI).not.toHaveBeenCalled();
    expect(mockSendEvent).not.toHaveBeenCalled();
  });
});
