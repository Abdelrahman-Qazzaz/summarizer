import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import type { logger } from "./logger";

type PreparationContext = {
  log: Pick<typeof logger, "info">;
  startedAt: number;
  parentOperationId?: string;
};

const preparationContext = new AsyncLocalStorage<PreparationContext>();

export function withPreparationMetrics<T>(
  context: PreparationContext,
  run: () => T,
): T {
  return preparationContext.run(context, run);
}

export async function measurePreparation<T>(
  operation: string,
  promiseAllId: string | undefined,
  run: () => PromiseLike<T>,
  details?: Record<string, number | boolean>,
): Promise<T> {
  const context = preparationContext.getStore();
  if (!context) return await run();

  const operationId = randomUUID();
  const startedAt = performance.now();
  let outcome = "fulfilled";
  try {
    return await preparationContext.run(
      { ...context, parentOperationId: operationId },
      run,
    );
  } catch (error) {
    outcome = "rejected";
    throw error;
  } finally {
    const finishedAt = performance.now();
    context.log.info("Message preparation operation completed", {
      operation,
      operationId,
      parentOperationId: context.parentOperationId,
      promiseAllId,
      outcome,
      durationMs: Math.round((finishedAt - startedAt) * 100) / 100,
      startOffsetMs: Math.round((startedAt - context.startedAt) * 100) / 100,
      completedAfterMs:
        Math.round((finishedAt - context.startedAt) * 100) / 100,
      ...details,
    });
  }
}
