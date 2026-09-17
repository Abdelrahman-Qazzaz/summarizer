import {
  mq,
  type DeliveryMetadata,
} from "../shared/message-queue/messageQueue";
import { scheduleSweeper } from "../shared/sweeper";
import { onShutdown } from "../shared/shutdown";
import { verifyTranscribeWorkerServices } from "./startup";
import { handleTranscribeJob } from "./transcribeJob";

await verifyTranscribeWorkerServices();

const inFlightJobs = new Set<Promise<void>>();

async function runJob(
  input: Parameters<typeof handleTranscribeJob>[0],
  delivery: DeliveryMetadata,
) {
  const job = Promise.resolve(handleTranscribeJob(input, delivery));
  inFlightJobs.add(job);

  try {
    await job;
  } finally {
    inFlightJobs.delete(job);
  }
}

const cancelConsumers = await Promise.all([
  mq.consume(mq.queues.TRANSCRIBE, (payload, delivery) =>
    runJob({ ...payload, useCaptionUpload: false }, delivery),
  ),
  mq.consume(mq.queues.CAPTION_TRANSCRIPT, (payload, delivery) =>
    runJob({ ...payload, useCaptionUpload: true }, delivery),
  ),
]);

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
    await Promise.all(cancelConsumers.map((cancel) => cancel()));
    await Promise.all([...inFlightJobs, stopSweeper()]);
    await mq.close();
  },
  { graceMs: 30_000 },
);
