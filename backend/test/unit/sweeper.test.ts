import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockWithAdvisoryLock, mockFindLedgerEntries, mockDeleteObjects } =
  vi.hoisted(() => ({
    mockWithAdvisoryLock: vi.fn(),
    mockFindLedgerEntries: vi.fn(),
    mockDeleteObjects: vi.fn(),
  }));

vi.mock("../../shared/data/advisoryLock.data", () => ({
  advisoryLock: {
    withAdvisoryLock: mockWithAdvisoryLock,
  },
}));
vi.mock("../../shared/data/storageLedger.data", () => ({
  storageLedger: {
    findLedgerEntries: mockFindLedgerEntries,
  },
}));
vi.mock("../../shared/uploads", () => ({
  UPLOAD_CONFIRM_WINDOW_MS: 2 * 60 * 60 * 1000,
  deleteObjects: mockDeleteObjects,
}));

import { scheduleSweeper, sweepUnusedObjects } from "../../shared/sweeper";

const HOUR_MS = 60 * 60 * 1000;

beforeEach(() => {
  vi.clearAllMocks();
  mockWithAdvisoryLock.mockImplementation(
    async (_name: string, run: () => unknown) => run(),
  );
  mockFindLedgerEntries.mockResolvedValue([]);
  mockDeleteObjects.mockResolvedValue(undefined);
});

describe("sweepUnusedObjects", () => {
  it("asks for unused objects past the grace, one batch at a time", async () => {
    const before = Date.now();

    await sweepUnusedObjects();

    const [{ statuses, createdBefore, limit }] = mockFindLedgerEntries.mock
      .calls[0] as [{ statuses: string[]; createdBefore: Date; limit: number }];
    expect(statuses).toEqual(["pending", "deleted"]);
    expect(limit).toBe(500);
    // Three hours: the two-hour confirm window plus half again.
    expect(createdBefore.getTime()).toBeGreaterThanOrEqual(
      before - 3 * HOUR_MS,
    );
    expect(createdBefore.getTime()).toBeLessThanOrEqual(
      Date.now() - 3 * HOUR_MS,
    );
  });

  it("releases each owner's objects together", async () => {
    mockFindLedgerEntries.mockResolvedValue([
      { userId: "u1", kind: "image", uploadId: "i1" },
      { userId: "u2", kind: "audio", uploadId: "a1" },
      { userId: "u1", kind: "text", uploadId: "t1" },
    ]);

    expect(await sweepUnusedObjects()).toBe(3);
    expect(mockDeleteObjects).toHaveBeenCalledTimes(2);
    expect(mockDeleteObjects).toHaveBeenCalledWith("u1", [
      { kind: "image", uploadId: "i1" },
      { kind: "text", uploadId: "t1" },
    ]);
    expect(mockDeleteObjects).toHaveBeenCalledWith("u2", [
      { kind: "audio", uploadId: "a1" },
    ]);
  });

  it("keeps going past an owner whose release fails", async () => {
    mockFindLedgerEntries.mockResolvedValue([
      { userId: "u1", kind: "image", uploadId: "i1" },
      { userId: "u2", kind: "image", uploadId: "i2" },
    ]);
    mockDeleteObjects.mockRejectedValueOnce(new Error("storage down"));

    expect(await sweepUnusedObjects()).toBe(1);
    expect(mockDeleteObjects).toHaveBeenCalledTimes(2);
  });

  it("does nothing while another process holds the lock", async () => {
    mockWithAdvisoryLock.mockResolvedValue(undefined);

    expect(await sweepUnusedObjects()).toBeUndefined();
    expect(mockFindLedgerEntries).not.toHaveBeenCalled();
  });
});

describe("scheduleSweeper", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sweeps at once, then every interval, until stopped", async () => {
    const stop = scheduleSweeper(HOUR_MS);
    await vi.advanceTimersByTimeAsync(0);
    expect(mockWithAdvisoryLock).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(mockWithAdvisoryLock).toHaveBeenCalledTimes(2);

    await stop();
    await vi.advanceTimersByTimeAsync(3 * HOUR_MS);
    expect(mockWithAdvisoryLock).toHaveBeenCalledTimes(2);
  });

  it("doesn't start a run while the last one is still going", async () => {
    let finish!: () => void;
    mockWithAdvisoryLock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    const stop = scheduleSweeper(HOUR_MS);
    await vi.advanceTimersByTimeAsync(2 * HOUR_MS);
    expect(mockWithAdvisoryLock).toHaveBeenCalledTimes(1);

    finish();
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(mockWithAdvisoryLock).toHaveBeenCalledTimes(2);
    await stop();
  });

  it("waits for a run in progress when stopped", async () => {
    let finish!: () => void;
    mockWithAdvisoryLock.mockImplementationOnce(
      () => new Promise<void>((resolve) => (finish = resolve)),
    );

    const stop = scheduleSweeper(HOUR_MS);
    let stopped = false;
    void stop().then(() => (stopped = true));
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(false);

    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(stopped).toBe(true);
  });

  it("survives a failed run", async () => {
    mockWithAdvisoryLock.mockRejectedValueOnce(new Error("db down"));

    const stop = scheduleSweeper(HOUR_MS);
    await vi.advanceTimersByTimeAsync(HOUR_MS);
    expect(mockWithAdvisoryLock).toHaveBeenCalledTimes(2);
    await stop();
  });
});
