import { Hono } from "hono";
import * as imagesController from "../controllers/images.controller";
import {
  imageReadRateLimiter,
  uploadRateLimiter,
} from "../middleware/rateLimit.middleware";
import { CTX_KEYS, FORM_KEYS } from "../../../shared/keys";
import {
  validateMultipart,
  validateReqParams,
} from "../middleware/validate.middleware";
import {
  imageUploadSchema,
  imageFetchParamSchema,
} from "../schema/images.schema";
import { requireAuth } from "../middleware/auth.middleware";

/**
 * Mounted under /upload/image, ahead of the parent's middleware, so nothing
 * here is reached by it: auth and both budgets are declared below. That's the
 * point — storing an image is an upload and spends that budget, while reading
 * one back re-signs at most once a week and gets a read-sized budget instead.
 */
export const imagesRouter = new Hono();

imagesRouter.use("*", requireAuth);

imagesRouter.post(
  "/",
  uploadRateLimiter,
  validateMultipart(imageUploadSchema, [FORM_KEYS.uploadFile]),
  imagesController.handleImageUpload,
);

imagesRouter.get(
  `/:${CTX_KEYS.uploadId}`,
  imageReadRateLimiter,
  validateReqParams(imageFetchParamSchema),
  imagesController.handleGetImage,
);

//TODO: add DELETE route, triggered either by user removing an image from the message input, or from a dashboard (batched)
