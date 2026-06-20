import { z } from "zod";
import { CTX_KEYS, FORM_KEYS } from "../../../../shared/keys";

const MAX_AUDIO_BYTES = 100 * 1024 * 1024; // 100MB
const MAX_TEXT_BYTES = 15 * 1024 * 1024; // 15MB

const fileField = z.instanceof(File, {
  message: 'Expected a file field named "file"',
});

export const textUploadSchema = z
  .object({
    [FORM_KEYS.file]: fileField,
    [FORM_KEYS.model]: z.string().min(1), // optional until client sends model
  })
  .superRefine((data, ctx) => {
    if (data[FORM_KEYS.file].size > MAX_TEXT_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Text file is too large",
        path: [FORM_KEYS.file],
      });
    }
  })
  .transform((data) => ({
    [CTX_KEYS.uploadFile]: data[FORM_KEYS.file],
    [CTX_KEYS.chosenModelId]: data[FORM_KEYS.model],
  }));

export const audioUploadSchema = z
  .object({
    [FORM_KEYS.file]: fileField,
    [FORM_KEYS.source]: z.preprocess(
      (v) => (v === "" || v === null ? undefined : v),
      z.enum(["video", "audio"]).optional().default("audio"),
    ),
    [FORM_KEYS.model]: z.string().min(1),
  })
  .superRefine((data, ctx) => {
    if (data[FORM_KEYS.file].size > MAX_AUDIO_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Audio file is too large",
        path: [FORM_KEYS.file],
      });
    }
  })
  .transform((data) => ({
    [CTX_KEYS.uploadFile]: data[FORM_KEYS.file],
    [CTX_KEYS.chosenModelId]: data[FORM_KEYS.model],
    [CTX_KEYS.audioSource]: data[FORM_KEYS.source],
  }));
