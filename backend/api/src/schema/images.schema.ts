import { z } from "zod";
import { CTX_KEYS, FORM_KEYS } from "../../../shared/keys";
// Shared with the audio confirm, so both reject a bad id or name alike.
import { fileNameField, uploadIdField } from "./upload.schema";

/**
 * POST /upload/image/confirm — the image is in the bucket; record it. Size and
 * type are not in the body: the controller reads both back from storage.
 */
export const imageConfirmSchema = z
  .object({
    [FORM_KEYS.uploadId]: uploadIdField,
    [FORM_KEYS.fileName]: fileNameField,
  })
  .transform((data) => ({
    [CTX_KEYS.imageUploadId]: data[FORM_KEYS.uploadId],
    [CTX_KEYS.fileName]: data[FORM_KEYS.fileName],
  }));

/** Identifies an uploaded image for read or deletion. */
export const imageReqParamSchema = z.object({
  [CTX_KEYS.imageUploadId]: z.string().uuid(),
});
