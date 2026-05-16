import type { UploadId } from "../../../shared/types/mq.types";
import { db, TextSummarizationJobs } from "../../../shared/db";
import { and, eq } from "drizzle-orm";
import { readTextFile } from "../../../shared/bucket";
import { summarize } from "../../../shared/ai/summarize";
import { mq } from "../../../shared/message-queue/messageQueue";

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
    const summary = await summarize(text);

    await db
      .update(TABLE)
      .set({ status: "completed", summary })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "processing")));

    await mq.sendEvent(mq.queues.SUMMARIZE_DONE, { uploadId });
  } catch (err) {
    await db
      .update(TABLE)
      .set({ status: "failed" })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "processing")));

    throw err;
  }
}
