import type { UploadId } from "../../../shared/types/mq.types";
import { db, TextSummarizationJobs } from "../../../shared/db";
import { and, eq } from "drizzle-orm";
import { readTextFile } from "../../../shared/bucket";
import { mq } from "../../../shared/message-queue/messageQueue";
import { logger } from "../../../shared/logger";
import { promptAI } from "../../../shared/ai/ai_client";

const log = logger.child({ worker: "summarize" });

// Flush buffered deltas to the client at most this often, to keep the number of
// SUMMARIZE_CHUNK messages on the (external, metered) broker low while still
// reading as a smooth live stream.
const CHUNK_FLUSH_MS = 150;
const CHUNK_FLUSH_CHARS = 200;

export async function handleSummarizeJob(uploadId: UploadId) {
  const TABLE = TextSummarizationJobs;
  try {
    const [job] = await db
      .update(TABLE)
      .set({ status: "processing" })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "queued")))
      .returning();

    if (!job) return;
    const text = await readTextFile(uploadId);

    const userId = job.userId;
    // For audio-derived summaries the client tracks the parent audio job, so
    // notify that id; for direct text uploads this is the job's own id.
    // audioUploadId is a nullable text column, so it widens to `string`; it
    // always holds an uploadId by construction.
    const notifyId = (job.audioUploadId ?? uploadId) as UploadId;

    // Buffer raw per-token deltas and flush them to the client on a timer (or
    // once the buffer grows past CHUNK_FLUSH_CHARS), so we publish ~tens of
    // messages per job instead of one per token. Sends are chained so chunks
    // reach the broker in the order they were produced.
    let buffer = "";
    let timer: NodeJS.Timeout | undefined;
    let sendChain: Promise<unknown> = Promise.resolve();

    const flush = () => {
      if (timer) {
        clearTimeout(timer);
        timer = undefined;
      }
      if (!buffer) return;
      const delta = buffer;
      buffer = "";
      sendChain = sendChain.then(() =>
        mq.sendEvent(mq.queues.SUMMARIZE_CHUNK, {
          uploadId: notifyId,
          userId,
          delta,
        }),
      );
    };

    try {
      const summary = await promptAI(
        job.chosenModelId,
        `Summarize the following text:\n\n${text}`,
        {
          onDelta: (delta) => {
            buffer += delta;
            if (buffer.length >= CHUNK_FLUSH_CHARS) flush();
            else timer ??= setTimeout(flush, CHUNK_FLUSH_MS);
          },
        },
      );

      flush(); // emit whatever is left
      await sendChain; // ensure all chunks are sent before the terminal event
      return await completeSummarizeJob(TABLE, uploadId, summary, notifyId, userId);
    } finally {
      if (timer) clearTimeout(timer);
    }
  } catch (err) {
    log.error("Summarization job failed", err, { uploadId });
    await db
      .update(TABLE)
      .set({ status: "failed" })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "processing")));

    throw err;
  }
}

async function completeSummarizeJob(
  TABLE: typeof TextSummarizationJobs,
  uploadId: UploadId,
  summary: string,
  notifyId: UploadId,
  userId: string,
) {
  await db
    .update(TABLE)
    .set({ status: "completed", summary })
    .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "processing")));

  await mq.sendEvent(mq.queues.SUMMARIZE_DONE, { uploadId: notifyId, userId });
}
