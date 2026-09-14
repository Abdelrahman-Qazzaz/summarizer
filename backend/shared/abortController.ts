class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  options: {
    timeoutMs: number;
    firstProgressTimeoutMs?: number;
    progressTimeoutMs?: number;
  },
  fn: (ctx: {
    abortSignal: AbortSignal;
    markProgress: () => void;
  }) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();

  let progressTimer: ReturnType<typeof setTimeout> | undefined;

  const abortAfter = (ms: number, message: string) =>
    setTimeout(() => {
      controller.abort(new TimeoutError(message));
    }, ms);

  const totalTimer = abortAfter(
    options.timeoutMs,
    `Operation took longer than ${options.timeoutMs} ms`,
  );

  if (options.firstProgressTimeoutMs) {
    progressTimer = abortAfter(
      options.firstProgressTimeoutMs,
      `No progress within ${options.firstProgressTimeoutMs} ms`,
    );
  }

  const markProgress = () => {
    clearTimeout(progressTimer);

    if (!options.progressTimeoutMs) return;

    progressTimer = abortAfter(
      options.progressTimeoutMs,
      `No progress for ${options.progressTimeoutMs} ms`,
    );
  };

  try {
    return await fn({
      abortSignal: controller.signal,
      markProgress,
    });
  } finally {
    clearTimeout(totalTimer);
    clearTimeout(progressTimer);
  }
}
