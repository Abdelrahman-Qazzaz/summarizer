import { mq } from "../shared/message-queue/messageQueue";
import { scheduleSweeper } from "../shared/sweeper";
import { onShutdown } from "../shared/shutdown";
import { verifyTranscribeWorkerServices } from "./startup";
import { handleTranscribeJob } from "./transcribeJob";

await verifyTranscribeWorkerServices();

/**
 * Every attempt at an audio job can be a billed Deepgram call (which retries
 * once on its own), so a failed job gets one more try, not several.
 */
const TRANSCRIBE_ATTEMPTS = 2;

await mq.consume(mq.queues.TRANSCRIBE, handleTranscribeJob, {
  attempts: TRANSCRIBE_ATTEMPTS,
});
await mq.consume(mq.queues.CAPTION_TRANSCRIPT, handleTranscribeJob, {
  attempts: TRANSCRIBE_ATTEMPTS,
});

// Every worker schedules it; the sweep's own lock keeps them from overlapping.
const stopSweeper = scheduleSweeper();

/**
 * Cancel first so the broker stops delivering, then let the job in progress
 * finish rather than paying the transcription provider twice for it.
 *
 * Abandoning it would still be correct — the delivery goes unacked and a fresh
 * worker reclaims the row under a new fencing token — so this grace period is
 * a cost measure, not a correctness one. A transcription that outlasts it is
 * simply redelivered.
 */
onShutdown(
  async () => {
    await Promise.all([mq.stopConsuming(), stopSweeper()]);
    await mq.close();
  },
  { graceMs: 30_000 },
);
