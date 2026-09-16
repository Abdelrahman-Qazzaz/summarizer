import { Hono } from "hono";
import * as uploadController from "../controllers/upload.controller";
import {
  uploadConfirmRateLimiter,
  uploadRateLimiter,
} from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { validateReqBody } from "../middleware/validate.middleware";
import {
  audioConfirmSchema,
  youtubeUploadSchema,
} from "../schema/upload.schema";
import { imagesRouter } from "./images.router";

export const uploadRouter = new Hono();

// Mounted above the `use()` below, so the sub-router declares its own auth and
// budgets — which is what keeps an image *read* off the upload budget.
uploadRouter.route("/image", imagesRouter);

// Budgets are per route: one upload is a mint and a confirm, and only the
// mint stands for the upload.
uploadRouter.use("*", requireAuth);

uploadRouter.post(
  "/audio",
  uploadRateLimiter,
  uploadController.handleAudioUploadUrl,
);
uploadRouter.post(
  "/audio/confirm",
  uploadConfirmRateLimiter,
  validateReqBody(audioConfirmSchema),
  uploadController.handleAudioConfirm,
);
uploadRouter.post(
  "/youtube",
  uploadRateLimiter,
  validateReqBody(youtubeUploadSchema),
  uploadController.handleYoutubeUpload,
);
