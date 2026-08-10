import { DeepgramClient } from "@deepgram/sdk";
import { getBaseEnv } from "../env";
import { claimAudioJob, failAudioJob } from "../data/jobs.data";
import { saveCompletedTranscript } from "../data/transcripts.data";
import { AUDIO_URL_TTL_SECONDS, createSignedUrl } from "../bucket";
import type { UploadId } from "../types/mq.types";
import { logger } from "../logger";
import { mq } from "../message-queue/messageQueue";
import { getCache, setCache } from "../cache/cache";

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

type TranscribeModel = {
  name: string;
  canonicalName: string;
  architecture: string | undefined;
  languages: string[] | undefined;
  version: string | undefined;
  uuid: string | undefined;
  batch: boolean | undefined;
  streaming: boolean | undefined;
  formattedOutput: boolean | undefined;
};

type TranscribeModelData = {
  [modelId: string]: TranscribeModel;
};

export async function getTranscribeModelData(): Promise<TranscribeModelData> {
  const hit = await getCache<TranscribeModelData>("deepgramTranscribeModels");
  if (hit != null) return hit;

  const response = await deepgram.manage.v1.models.list();
  const modelData: TranscribeModelData = Object.fromEntries(
    (response.stt ?? []).flatMap((model) => {
      const id = model.canonical_name ?? model.name;
      if (!id) return [];
      return [
        [
          id,
          {
            name: model.name ?? id,
            canonicalName: model.canonical_name ?? id,
            architecture: model.architecture,
            languages: model.languages,
            version: model.version,
            uuid: model.uuid,
            batch: model.batch,
            streaming: model.streaming,
            formattedOutput: model.formatted_output,
          },
        ],
      ];
    }),
  );

  await setCache("deepgramTranscribeModels", modelData);
  return modelData;
}

/**
 * Whether a model id can be used for transcription. Deepgram STT models are
 * single-modality, so presence in the catalog is the whole check — the analog
 * of validateModelOutput(id, "transcription") on the chat side. A model id can
 * arrive as either the display `name` or the `canonical_name`, so both are
 * matched.
 */
export async function isValidTranscribeModel(modelId: string): Promise<boolean> {
  const modelData = await getTranscribeModelData();

  if (modelData[modelId]) return true;
  return Object.values(modelData).some(
    (model) => model.name === modelId || model.canonicalName === modelId,
  );
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

    // Store the transcript (keyed by this job's uploadId; a re-run overwrites
    // it) and mark the job done in one transaction, so a completed job always
    // has a readable transcript and vice versa.
    await saveCompletedTranscript(job.userId, uploadId, transcript);
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
