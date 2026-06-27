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
  validateMultipart(textUploadSchema, [
    FORM_KEYS.uploadFile,
    FORM_KEYS.chosenModelId,
  ]),
  uploadController.handleTextUpload,
);
uploadRouter.post(
  "/audio",
  validateMultipart(audioUploadSchema, [
    FORM_KEYS.uploadFile,
    FORM_KEYS.audioSource,
    FORM_KEYS.chosenModelId,
  ]),
  uploadController.handleAudioUpload,
);
