import { DeepgramClient } from "@deepgram/sdk";
import { getBaseEnv } from "../env";
import { getCache, setCache } from "../cache/cache";

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

export async function transcribeAI(
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
export async function isValidTranscribeModel(
  modelId: string,
): Promise<boolean> {
  const modelData = await getTranscribeModelData();

  if (modelData[modelId]) return true;
  return Object.values(modelData).some(
    (model) => model.name === modelId || model.canonicalName === modelId,
  );
}

export const DEFAULT_TRANSCRIBE_MODEL = "nova-3";
