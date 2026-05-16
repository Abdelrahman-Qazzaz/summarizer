import { mq } from "../../../shared/message-queue/messageQueue";
import {  handleTranscribeJob } from "./transcribe.worker";
import { handleSummarizeJob } from "./summarize.worker";

export function attachListeners() {
  mq.listen(mq.queues.TRANSCRIBE, handleTranscribeJob);
  mq.listen(mq.queues.SUMMARIZE, handleSummarizeJob);
}
