import { mq } from "../shared/message-queue/messageQueue";
import { onShutdown } from "../shared/shutdown";
import { verifyTranscribeWorkerServices } from "./startup";
import { handleTranscribeJob } from "./transcribeJob";

await verifyTranscribeWorkerServices();

/**
 * The channel uses prefetch(1), so at most one job is ever in flight and this
 * is the whole of the worker's state.
 */
let inFlight: Promise<void> | null = null;

const cancelConsumer = await mq.consume(
  mq.queues.TRANSCRIBE,
  async (payload, delivery) => {
    inFlight = Promise.resolve(handleTranscribeJob(payload, delivery));
    try {
      await inFlight;
    } finally {
      inFlight = null;
    }
  },
);

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
    await cancelConsumer();
    if (inFlight) await inFlight;
    await mq.close();
  },
  { graceMs: 30_000 },
);
