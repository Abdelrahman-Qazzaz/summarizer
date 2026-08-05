import { z } from "zod";
import { CTX_KEYS, FORM_KEYS } from "../../../shared/keys";
import { MAX_IMAGE_BYTES } from "../../../shared/bucket";
// Shared with the job uploads so the "missing file field" message stays one
// string; nothing else here is common with them.
import { fileField } from "./upload.schema";

/**
 * POST /upload/image — a standalone image (dropped into the chat, or uploaded
 * from the navbar mode). No model/job involved: it's stored for later
 * reference and handed to the chat model as vision input once attached to a
 * sent message.
 */
export const imageUploadSchema = z
  .object({
    [FORM_KEYS.uploadFile]: fileField,
  })
  .superRefine((data, ctx) => {
    const file = data[FORM_KEYS.uploadFile];
    if (!file.type.startsWith("image/")) {
      ctx.addIssue({
        code: "custom",
        message: "File must be an image",
        path: [FORM_KEYS.uploadFile],
      });
    }
    if (file.size > MAX_IMAGE_BYTES) {
      ctx.addIssue({
        code: "custom",
        message: "Image is too large",
        path: [FORM_KEYS.uploadFile],
      });
    }
  })
  .transform((data) => ({
    [CTX_KEYS.uploadFile]: data[FORM_KEYS.uploadFile],
  }));

/** GET /upload/image/:uploadId — re-sign a previously uploaded image's URL. */
export const imageFetchParamSchema = z.object({
  [CTX_KEYS.uploadId]: z.string().uuid(),
});
