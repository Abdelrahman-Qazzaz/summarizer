import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { createAudioJob } from "../../../shared/data/jobs.data";
import { queueAudioTranscription } from "../../../shared/audioTranscription";
import { createUploadUrl, takeUploadedObject } from "../../../shared/bucket";
import { mq } from "../../../shared/message-queue/messageQueue";
import { CTX_KEYS } from "../../../shared/keys";
import type { UploadId } from "../../../shared/types";

/**
 * POST /upload/audio — a URL the browser PUTs speech audio to, straight into
 * storage. The id is minted here rather than chosen by the client, so the key
 * the URL is bound to is one nothing else is using.
 *
 * No row is written yet. An upload that never completes leaves at worst an
 * unreferenced object, rather than a job stuck queued in the user's sources.
 */
export async function handleAudioUploadUrl(c: Context) {
  const userId = c.get(CTX_KEYS.userId);

  const audioUploadId: UploadId = randomUUID();
  const signedUploadUrl = await createUploadUrl(userId, {
    kind: "audio",
    uploadId: audioUploadId,
  });

  return c.json({ uploadId: audioUploadId, signedUploadUrl });
}

/**
 * POST /upload/audio/confirm — the audio is in the bucket: check it, then
 * start its transcription.
 *
 * The key carries the kind, so an id minted for an image finds nothing here.
 */
export async function handleAudioConfirm(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const audioUploadId: UploadId = c.get(CTX_KEYS.audioUploadId);
  const fileName = c.get(CTX_KEYS.fileName);
  const source = c.get(CTX_KEYS.audioSource);
  const transcriptModelId = c.get(CTX_KEYS.transcriptModelId);

  const upload = await takeUploadedObject(userId, {
    kind: "audio",
    uploadId: audioUploadId,
  });
  if (!upload.ok) {
    switch (upload.reason) {
      case "missing":
        return c.json({ message: "No uploaded audio to confirm" }, 404);
      case "wrong-type":
        return c.json(
          {
            message: `Expected an audio file, got: ${upload.contentType || "unknown"}`,
          },
          400,
        );
      case "too-large":
        return c.json(
          { message: "Audio file is too large", maxBytes: upload.maxBytes },
          413,
        );
    }
  }

  const queued = await queueAudioTranscription({
    audioUploadId,
    userId,
    source,
    fileName,
    mimeType: upload.contentType,
    sizeBytes: upload.sizeBytes,
    transcriptModelId,
  });
  if (!queued) {
    return c.json({ message: "This upload was already confirmed" }, 409);
  }

  return c.json({
    message: "File uploaded",
    audioUploadId,
    fileName,
    size: upload.sizeBytes,
    mimeType: upload.contentType,
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

  // Created queued with placeholder metadata. The fetcher tries a reserved
  // caption object first when requested, otherwise it writes audio under
  // `audioUploadId` and sends the appropriate worker delivery.
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
