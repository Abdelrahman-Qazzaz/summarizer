import { mq } from "../shared/message-queue/messageQueue";
import { verifyTranscribeWorkerServices } from "./startup";
import { handleTranscribeJob } from "./transcribeJob";

await verifyTranscribeWorkerServices();
await mq.consume(mq.queues.TRANSCRIBE, handleTranscribeJob);
