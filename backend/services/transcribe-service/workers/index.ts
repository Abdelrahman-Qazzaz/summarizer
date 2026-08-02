import { mq } from "../../../shared/message-queue/messageQueue";
import { handleTranscribeJob } from "./transcribe.worker";
import { logger } from "../../../shared/logger";

/** Attach the queue consumers this process is responsible for. */
export function attachListeners() {
  mq.listen(mq.queues.TRANSCRIBE, handleTranscribeJob);
  logger.info("Worker listeners attached");
}
