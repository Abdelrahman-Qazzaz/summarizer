import { randomUUID } from "node:crypto";
import type { Context } from "hono";
import { data } from "../../../shared/data";
import {
  publishOrFail,
  queueAudioTranscription,
} from "../../../shared/audioTranscription";
import { checkUpload, startUpload } from "../../../shared/uploads";
import { mq } from "../../../shared/message-queue/messageQueue";
import { CTX_KEYS } from "../../../shared/keys";
import { ALREADY_CONFIRMED, uploadRejection } from "../utils/uploadRejection";
import type { UploadId } from "../../../shared/types";

/**
 * POST /upload/audio — a URL the browser PUTs speech audio to, straight into
 * storage. The id is minted here rather than chosen by the client, so the key
 * the URL is bound to is one nothing else is using.
 *
 * Only the upload's ledger record is written, not a job: an upload that never
 * completes is the sweep's to remove, rather than a job stuck queued in the
 * user's sources.
 */
export async function handleAudioUploadUrl(c: Context) {
  const userId = c.get(CTX_KEYS.userId);

  const audioUploadId: UploadId = randomUUID();
  const signedUploadUrl = await startUpload(userId, {
    kind: "audio",
    uploadId: audioUploadId,
  });

  return c.json({ uploadId: audioUploadId, signedUploadUrl });
}

/**
 * POST /upload/audio/confirm — the audio is in the bucket: check it, then
 * start its transcription.
 *
 * The upload must be pending in the ledger for this user as audio, so an id
 * minted for an image — or someone else's — is a 404. A rejected upload is
 * answered and left as it is; the sweep removes it.
 */
const AUDIO_WORDING = {
  noun: "audio",
  wrongType: (contentType: string) =>
    `Expected an audio file, got: ${contentType || "unknown"}`,
  tooLarge: "Audio file is too large",
};

export async function handleAudioConfirm(c: Context) {
  const userId = c.get(CTX_KEYS.userId);
  const audioUploadId: UploadId = c.get(CTX_KEYS.audioUploadId);
  const fileName = c.get(CTX_KEYS.fileName);
  const source = c.get(CTX_KEYS.audioSource);
  const transcriptModelId = c.get(CTX_KEYS.transcriptModelId);

  const upload = await checkUpload(userId, {
    kind: "audio",
    uploadId: audioUploadId,
  });
  if (!upload.ok) {
    const [body, status] = uploadRejection(upload, AUDIO_WORDING);
    return c.json(body, status);
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
    return c.json({ message: ALREADY_CONFIRMED }, 409);
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
  await data.jobs.createYoutubeAudioJob({
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

  // A failed publish would leave the job queued with no fetcher coming for
  // it; failing it puts that in front of the user instead.
  await publishOrFail(audioUploadId, () =>
    mq.publish(mq.queues.YT_FETCH, {
      audioUploadId,
      captionUploadId,
      url,
      userId,
      useCaptionsIfAvailable,
    }),
  );
  return c.json({
    message: "Queued",
    audioUploadId,
    source: "youtube" as const,
    url,
  });
}
