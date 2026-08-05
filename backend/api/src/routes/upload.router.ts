import { Hono } from "hono";
import * as uploadController from "../controllers/upload.controller";
import { uploadRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { FORM_KEYS } from "../../../shared/keys";
import {
  validateMultipart,
  validateReqBody,
} from "../middleware/validate.middleware";
import {
  audioUploadSchema,
  youtubeUploadSchema,
} from "../schema/upload.schema";
import { imagesRouter } from "./images.router";

export const uploadRouter = new Hono();

// Mounted above the `use()` below on purpose: Hono composes matching handlers
// in registration order, so these routes answer and return before it runs —
// which is what keeps an image *read* off the upload budget. The flip side is
// that nothing below reaches them, so the sub-router declares its own auth.
uploadRouter.route("/image", imagesRouter);

uploadRouter.use("*", requireAuth, uploadRateLimiter);

uploadRouter.post(
  "/audio",
  validateMultipart(audioUploadSchema, [
    FORM_KEYS.uploadFile,
    FORM_KEYS.audioSource,
    FORM_KEYS.transcriptionModelId,
  ]),
  uploadController.handleAudioUpload,
);
uploadRouter.post(
  "/youtube",
  validateReqBody(youtubeUploadSchema),
  uploadController.handleYoutubeUpload,
);
