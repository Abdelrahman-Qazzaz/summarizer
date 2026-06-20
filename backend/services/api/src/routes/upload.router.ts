import { Hono } from "hono";
import * as uploadController from "../controllers/upload.controller";
import { uploadRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { FORM_KEYS } from "../../../../shared/keys";
import { validateMultipart } from "../middleware/validate.middleware";
import { textUploadSchema, audioUploadSchema } from "../schema/upload.schema";

export const uploadRouter = new Hono();

uploadRouter.use("*", requireAuth, uploadRateLimiter);

uploadRouter.post(
  "/text",
  validateMultipart(textUploadSchema, [FORM_KEYS.file, FORM_KEYS.model]),
  uploadController.handleTextUpload,
);
uploadRouter.post(
  "/audio",
  validateMultipart(audioUploadSchema, [
    FORM_KEYS.file,
    FORM_KEYS.source,
    FORM_KEYS.model,
  ]),
  uploadController.handleAudioUpload,
);
