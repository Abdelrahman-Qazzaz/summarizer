import { DeepgramClient } from "@deepgram/sdk";
import { getBaseEnv } from "../env";

const deepgram = new DeepgramClient({ apiKey: getBaseEnv().DEEPGRAM_API_KEY });

/**
 * Deepgram transcribes a multi-hour file in one job, but a long one can take
 * minutes to come back — far past the SDK's default timeout. Retries are held
 * to one because every attempt is billed for the full audio duration.
 */
const TRANSCRIBE_TIMEOUT_SECONDS = 20 * 60;
const TRANSCRIBE_MAX_RETRIES = 1;

/** Startup health check: fails if Deepgram is unreachable or rejects the API key. */
export async function pingTranscriber(): Promise<void> {
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

export const DEFAULT_TRANSCRIBE_MODEL = "nova-3";
