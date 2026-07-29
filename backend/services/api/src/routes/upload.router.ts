import { Hono } from "hono";
import * as uploadController from "../controllers/upload.controller";
import { uploadRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { CTX_KEYS, FORM_KEYS } from "../../../../shared/keys";
import {
  validateMultipart,
  validateReqBody,
  validateReqParams,
} from "../middleware/validate.middleware";
import {
  textUploadSchema,
  audioUploadSchema,
  youtubeUploadSchema,
  imageUploadSchema,
  imageFetchParamSchema,
} from "../schema/upload.schema";

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
    FORM_KEYS.transcriptionModelId,
  ]),
  uploadController.handleAudioUpload,
);
uploadRouter.post(
  "/youtube",
  validateReqBody(youtubeUploadSchema),
  uploadController.handleYoutubeUpload,
);
uploadRouter.post(
  "/image",
  validateMultipart(imageUploadSchema, [FORM_KEYS.uploadFile]),
  uploadController.handleImageUpload,
);
uploadRouter.get(
  `/image/:${CTX_KEYS.uploadId}`,
  validateReqParams(imageFetchParamSchema),
  uploadController.handleGetImage,
);
