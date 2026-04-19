import { mq } from "../../../shared/message-queue/messageQueue";
import { handleTranscribe } from "./transcribe.worker";
import { handleSummarize } from "./summarize.worker";

export function attachListeners() {
  mq.listen(mq.queues.TRANSCRIBE, handleTranscribe);
  mq.listen(mq.queues.SUMMARIZE, handleSummarize);
}
