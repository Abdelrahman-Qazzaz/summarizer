import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { withTimeout } from "../../shared/abortController";

describe("withTimeout", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("stops the first-progress limit once progress is marked, even with no between-progress limit", async () => {
    const result = withTimeout(
      { timeoutMs: 60_000, firstProgressTimeoutMs: 1_000 },
      async ({ abortSignal, markProgress }) => {
        markProgress();
        await new Promise((resolve) => setTimeout(resolve, 5_000));
        return abortSignal.aborted;
      },
    );

    await vi.advanceTimersByTimeAsync(5_000);
    await expect(result).resolves.toBe(false);
  });
});
