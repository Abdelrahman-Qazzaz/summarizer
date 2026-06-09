import type { UploadId } from "../../../shared/types/mq.types";
import {
  db,
  AudioTranscriptionJobs,
  TextSummarizationJobs,
} from "../../../shared/db";
import { and, eq } from "drizzle-orm";
import { getAudioFile, uploadTextToBucket } from "../../../shared/bucket";
import { transcribe } from "../../../shared/ai/transcribe";
import { mq } from "../../../shared/message-queue/messageQueue";
import { randomUUID } from "crypto";

export async function handleTranscribeJob(uploadId: UploadId) {
  const TABLE = AudioTranscriptionJobs;
  try {
    const [job] = await db
      .update(TABLE)
      .set({ status: "processing" })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "queued")))
      .returning();

    if (!job) return;

    const audio = await getAudioFile(uploadId);
    const transcript = await transcribe(audio);
    const textUploadId: UploadId = randomUUID();
    await db
      .update(TABLE)
      .set({ status: "completed", transcript })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "processing")));

    const userId = job.userId;
    await mq.sendEvent(mq.queues.TRANSCRIBE_DONE, { uploadId, userId });

    await uploadTextToBucket(textUploadId, transcript);
    const fileName = `${job.fileName}.txt`;
    const sizeBytes = Buffer.byteLength(transcript, "utf8");
    await db
      .insert(TextSummarizationJobs)
      .values({ uploadId: textUploadId, userId, fileName, sizeBytes });
    await mq.sendEvent(mq.queues.SUMMARIZE, textUploadId);
  } catch (err) {
    await db
      .update(TABLE)
      .set({ status: "failed" })
      .where(and(eq(TABLE.uploadId, uploadId), eq(TABLE.status, "processing")));

    throw err;
  }
}
