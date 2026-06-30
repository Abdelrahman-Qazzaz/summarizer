import { z } from "zod";
import { CTX_KEYS, FORM_KEYS } from "../../../../shared/keys";
import { validateModel, DEFAULT_MODELS } from "../../../../shared/ai/ai_client";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_TEXT_BYTES = 15 * 1024 * 1024; // 15MB

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
