import { z } from "zod";
import { CTX_KEYS, FORM_KEYS } from "../../../../shared/keys";
import { validateModel, DEFAULT_MODELS } from "../../../../shared/ai/ai_client";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_TEXT_BYTES = 15 * 1024 * 1024; // 15MB

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

const fileField = z.instanceof(File, {
  message: 'Expected a file field named "file"',
});

export const textUploadSchema = z
  .object({
    [FORM_KEYS.uploadFile]: fileField,
    [FORM_KEYS.chosenModelId]: z.string().min(1),
  })
  .superRefine(async (data, ctx) => {
    if (data[FORM_KEYS.uploadFile].size > MAX_TEXT_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Text file is too large",
        path: [FORM_KEYS.uploadFile],
      });
    }
    if (!(await validateModel(data[FORM_KEYS.chosenModelId], "text"))) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid summary model: must be a text model",
        path: [FORM_KEYS.chosenModelId],
      });
    }
  })
  .transform((data) => ({
    [CTX_KEYS.uploadFile]: data[FORM_KEYS.uploadFile],
    [CTX_KEYS.chosenModelId]: data[FORM_KEYS.chosenModelId],
  }));

export const audioUploadSchema = z
  .object({
    [FORM_KEYS.uploadFile]: fileField,
    [FORM_KEYS.audioSource]: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z
        .enum(["video", "audio"], {
          errorMap: () => ({
            message: 'Invalid source; use "video" or "audio" (or omit)',
          }),
        })
        .optional()
        .default("audio"),
    ),
    [FORM_KEYS.chosenModelId]: z.string().min(1),
    // Optional; omit (or send empty) to use the default transcription model.
    [FORM_KEYS.transcriptionModelId]: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.string().min(1).optional().default(DEFAULT_MODELS.TRANSCRIBE),
    ),
  })
  .superRefine(async (data, ctx) => {
    if (data[FORM_KEYS.uploadFile].size > MAX_AUDIO_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Audio file is too large",
        path: [FORM_KEYS.uploadFile],
      });
    }
    if (!(await validateModel(data[FORM_KEYS.chosenModelId], "text"))) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid summary model: must be a text model",
        path: [FORM_KEYS.chosenModelId],
      });
    }
    if (
      !(await validateModel(
        data[FORM_KEYS.transcriptionModelId],
        "transcription",
      ))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid transcription model",
        path: [FORM_KEYS.transcriptionModelId],
      });
    }
  })
  .transform((data) => ({
    [CTX_KEYS.uploadFile]: data[FORM_KEYS.uploadFile],
    [CTX_KEYS.chosenModelId]: data[FORM_KEYS.chosenModelId],
    [CTX_KEYS.transcriptionModelId]: data[FORM_KEYS.transcriptionModelId],
    [CTX_KEYS.audioSource]: data[FORM_KEYS.audioSource],
  }));

/**
 * POST /upload/youtube — a YouTube URL. Unlike audio/text this is a JSON body
 * (no file); the youtube-fetcher service downloads the audio out of band, so the
 * job is created with placeholder file metadata (real title/size are unknown
 * until the fetch completes).
 */
export const youtubeUploadSchema = z
  .object({
    [CTX_KEYS.youtubeUrl]: z.string().url(),
    [FORM_KEYS.chosenModelId]: z.string().min(1),
    [FORM_KEYS.transcriptionModelId]: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.string().min(1).optional().default(DEFAULT_MODELS.TRANSCRIBE),
    ),
  })
  .superRefine(async (data, ctx) => {
    if (!isYoutubeUrl(data[CTX_KEYS.youtubeUrl])) {
      ctx.addIssue({
        code: "custom",
        message: "Not a valid YouTube URL",
        path: [CTX_KEYS.youtubeUrl],
      });
    }
    if (!(await validateModel(data[FORM_KEYS.chosenModelId], "text"))) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid summary model: must be a text model",
        path: [FORM_KEYS.chosenModelId],
      });
    }
    if (
      !(await validateModel(
        data[FORM_KEYS.transcriptionModelId],
        "transcription",
      ))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid transcription model",
        path: [FORM_KEYS.transcriptionModelId],
      });
    }
  })
  .transform((data) => ({
    [CTX_KEYS.youtubeUrl]: data[CTX_KEYS.youtubeUrl],
    [CTX_KEYS.chosenModelId]: data[FORM_KEYS.chosenModelId],
    [CTX_KEYS.transcriptionModelId]: data[FORM_KEYS.transcriptionModelId],
  }));
