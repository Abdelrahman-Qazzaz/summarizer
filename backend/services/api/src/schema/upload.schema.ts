import { z } from "zod";
import { CTX_KEYS, FORM_KEYS } from "../../../../shared/keys";
import {
  validateModelOutput,
  DEFAULT_MODELS,
} from "../../../../shared/ai/ai_client";
import { MAX_AUDIO_BYTES } from "../../../../shared/bucket";

const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

function isYoutubeUrl(raw: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

export const fileField = z.instanceof(File, {
  message: 'Expected a file field named "file"',
});

/** Multipart sends absent optional fields as "" (or null); treat both as unset. */
const blankToUndefined = (v: unknown) =>
  v === "" || v === null ? undefined : v;

/**
 * The transcription model is optional on every route that has one — omit it
 * (or send blank) to get the default.
 */
const transcriptionModelField = z.preprocess(
  blankToUndefined,
  z.string().min(1).optional().default(DEFAULT_MODELS.TRANSCRIBE),
);

/**
 * Shared by the audio and youtube routes so the two reject an unusable model
 * with one message on one path rather than two copies that can drift apart.
 */
async function refineTranscriptionModel(modelId: string, ctx: z.RefinementCtx) {
  if (await validateModelOutput(modelId, "transcription")) return;
  ctx.addIssue({
    code: "custom",
    message: "Invalid transcription model",
    path: [FORM_KEYS.transcriptionModelId],
  });
}

export const audioUploadSchema = z
  .object({
    [FORM_KEYS.uploadFile]: fileField,
    [FORM_KEYS.audioSource]: z.preprocess(
      blankToUndefined,
      z
        .enum(["video", "audio"], {
          errorMap: () => ({
            message: 'Invalid source; use "video" or "audio" (or omit)',
          }),
        })
        .optional()
        .default("audio"),
    ),
    [FORM_KEYS.transcriptionModelId]: transcriptionModelField,
  })
  .superRefine(async (data, ctx) => {
    if (data[FORM_KEYS.uploadFile].size > MAX_AUDIO_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Audio file is too large",
        path: [FORM_KEYS.uploadFile],
      });
    }
    await refineTranscriptionModel(data[FORM_KEYS.transcriptionModelId], ctx);
  })
  .transform((data) => ({
    [CTX_KEYS.uploadFile]: data[FORM_KEYS.uploadFile],
    [CTX_KEYS.transcriptionModelId]: data[FORM_KEYS.transcriptionModelId],
    [CTX_KEYS.audioSource]: data[FORM_KEYS.audioSource],
  }));

/**
 * POST /upload/youtube — a YouTube URL. Unlike audio this is a JSON body (no
 * file); the youtube-fetcher service downloads the audio out of band, so the
 * job is created with placeholder file metadata (real title/size are unknown
 * until the fetch completes).
 */
export const youtubeUploadSchema = z
  .object({
    [CTX_KEYS.youtubeUrl]: z.string().url(),
    [FORM_KEYS.transcriptionModelId]: transcriptionModelField,
  })
  .superRefine(async (data, ctx) => {
    if (!isYoutubeUrl(data[CTX_KEYS.youtubeUrl])) {
      ctx.addIssue({
        code: "custom",
        message: "Not a valid YouTube URL",
        path: [CTX_KEYS.youtubeUrl],
      });
    }
    await refineTranscriptionModel(data[FORM_KEYS.transcriptionModelId], ctx);
  })
  .transform((data) => ({
    [CTX_KEYS.youtubeUrl]: data[CTX_KEYS.youtubeUrl],
    [CTX_KEYS.transcriptionModelId]: data[FORM_KEYS.transcriptionModelId],
  }));
