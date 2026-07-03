import { mq } from "../../../shared/message-queue/messageQueue";
import { handleTranscribeJob } from "./transcribe.worker";
import { handleSummarizeJob } from "./summarize.worker";
import type { WorkerRole } from "../../../shared/env";
import { logger } from "../../../shared/logger";

/**
 * Attach the queue consumers this process is responsible for. Split by
 * `WORKER_ROLE` so transcribe and summarize can be deployed and scaled as
 * separate replica pools; `all` runs both (used in local dev).
 */
export function attachListeners(role: WorkerRole) {
  if (role !== "summarize") {
    mq.listen(mq.queues.TRANSCRIBE, handleTranscribeJob);
  }
  if (role !== "transcribe") {
    mq.listen(mq.queues.SUMMARIZE, handleSummarizeJob);
  }
  logger.info("Worker listeners attached", { role });
}
