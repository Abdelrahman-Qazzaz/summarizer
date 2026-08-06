import { DeepgramClient } from "@deepgram/sdk";
import { getBaseEnv } from "../env";
import {
  claimAudioJob,
  completeAudioJob,
  failAudioJob,
} from "../data/jobs.data";
import {
  AUDIO_URL_TTL_SECONDS,
  createSignedUrl,
  uploadTextToBucket,
} from "../bucket";
import type { UploadId } from "../types/mq.types";
import { randomUUID } from "crypto";
import { logger } from "../logger";
import { mq } from "../message-queue/messageQueue";

const log = logger.child({ ai_transcribe_client: "transcribe" });

const deepgram = new DeepgramClient({ apiKey: getBaseEnv().DEEPGRAM_API_KEY });

/**
 * Deepgram transcribes a multi-hour file in one job, but a long one can take
 * minutes to come back — far past the SDK's default timeout. Retries are held
 * to one because every attempt is billed for the full audio duration.
 */
const TRANSCRIBE_TIMEOUT_SECONDS = 20 * 60;
const TRANSCRIBE_MAX_RETRIES = 1;

/** Startup health check: fails if Deepgram is unreachable or rejects the API key. */
export async function pingTranscribeAI(): Promise<void> {
  await deepgram.auth.v1.tokens.grant();
}

export async function transcribe(
  model: string,
  audioUrl: string,
): Promise<string> {
  const response = await deepgram.listen.v1.media.transcribeUrl(
    {
      url: audioUrl,
      model,
      smart_format: true,
      paragraphs: true,
    },
    {
      timeoutInSeconds: TRANSCRIBE_TIMEOUT_SECONDS,
      maxRetries: TRANSCRIBE_MAX_RETRIES,
    },
  );

  // The response type also covers the callback mode, which answers with just a
  // request id. We never pass `callback`, so a body without results is a bug
  // rather than something to poll for.
  if (!("results" in response)) {
    throw new Error("Deepgram returned no transcription results");
  }

  const [alternative] = response.results.channels[0]?.alternatives ?? [];

  // `paragraphs.transcript` is the same text broken into paragraphs, which
  // reads better as summarizer input than the single unbroken line.
  return alternative?.paragraphs?.transcript ?? alternative?.transcript ?? "";
}

export async function handleTranscribeJob(uploadId: UploadId) {
  try {
    const job = await claimAudioJob(uploadId);

    if (!job) return;

    // A signed URL rather than the bytes: the provider fetches the object
    // itself, so audio length never becomes this process's memory problem.
    const audioUrl = await createSignedUrl(
      job.userId,
      uploadId,
      AUDIO_URL_TTL_SECONDS,
    );
    const model = job.transcriptionModelId ?? DEFAULT_TRANSCRIBE_MODEL;
    const transcript = await transcribe(model, audioUrl);
    if (!transcript.trim()) {
      throw new Error("Transcription produced no text");
    }
    log.debug("Transcription produced", {
      uploadId,
      length: transcript.length,
    });

    // The audio occupies this job's own uploadId, so the transcript needs a key
    // of its own. A re-run reuses the key it already has and overwrites the
    // object — hence the upsert. Minting a fresh id per run would instead leave
    // the previous transcript orphaned in the bucket.
    const transcriptUploadId: UploadId =
      (job.transcriptUploadId as UploadId | null) ?? randomUUID();
    await uploadTextToBucket(job.userId, transcriptUploadId, transcript, {
      upsert: true,
    });

    await completeAudioJob(uploadId, transcriptUploadId);
    await mq.sendEvent(mq.queues.TRANSCRIBE_DONE, {
      uploadId,
      userId: job.userId,
    });
  } catch (err) {
    log.error("Transcription job failed", err, { uploadId });
    await failAudioJob(uploadId);

    throw err;
  }
}

export const DEFAULT_TRANSCRIBE_MODEL = "nova-3";
