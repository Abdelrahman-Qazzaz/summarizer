import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { createAudioJob } from "../../../shared/data/jobs.data";
import { uploadAudioToBucket } from "../../../shared/bucket";
import { mq } from "../../../shared/message-queue/messageQueue";
import { CTX_KEYS } from "../../../shared/keys";
import type { UploadId } from "../../../shared/types";

/** POST /upload/audio — speech audio (from direct upload or client-extracted from video). */
export async function handleAudioUpload(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const file = c.get(CTX_KEYS.uploadFile);
  const transcriptModelId = c.get(CTX_KEYS.transcriptModelId);

  const source = c.get(CTX_KEYS.audioSource);

  const audioUploadId: UploadId = randomUUID();
  await uploadAudioToBucket(userId, audioUploadId, file);

  await createAudioJob({
    audioUploadId,
    captionUploadId: null,
    userId,
    source,
    fileName: file.name,
    mimeType: file.type || null,
    sizeBytes: file.size,
    transcriptModelId,
  });

  await mq.publish(mq.queues.TRANSCRIBE, { audioUploadId });
  return c.json({
    message: "File uploaded",
    audioUploadId,
    fileName: file.name,
    size: file.size,
    mimeType: file.type || null,
    source,
  });
}

/** POST /upload/youtube — a YouTube URL fetched out of band by youtube-fetcher. */
export async function handleYoutubeUpload(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const url = c.get(CTX_KEYS.youtubeUrl);
  const transcriptModelId = c.get(CTX_KEYS.transcriptModelId);
  const useCaptionsIfAvailable = c.get(CTX_KEYS.useCaptionsIfAvailable);

  const audioUploadId: UploadId = randomUUID();
  const captionUploadId: UploadId | null = useCaptionsIfAvailable
    ? randomUUID()
    : null;

  // Created queued with placeholder file metadata — the youtube-fetcher hasn't
  // downloaded anything yet. It uploads the audio to the bucket at `audioUploadId`
  // then publishes `transcribe`, so the row is claimed by the transcribe worker
  // exactly like a normal audio upload.
  await createAudioJob({
    audioUploadId,
    captionUploadId,
    userId,
    source: "youtube",
    youtubeSourceUrl: url,
    fileName: "YouTube audio",
    mimeType: null,
    sizeBytes: 0,
    transcriptModelId,
  });

  await mq.publish(mq.queues.YT_FETCH, {
    audioUploadId,
    captionUploadId,
    url,
    userId,
    useCaptionsIfAvailable,
  });
  return c.json({
    message: "Queued",
    audioUploadId,
    source: "youtube" as const,
    url,
  });
}
