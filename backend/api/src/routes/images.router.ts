import { Hono } from "hono";
import * as imagesController from "../controllers/images.controller";
import {
  imageReadRateLimiter,
  uploadConfirmRateLimiter,
  uploadRateLimiter,
} from "../middleware/rateLimit.middleware";
import { CTX_KEYS } from "../../../shared/keys";
import {
  validateReqBody,
  validateReqParams,
} from "../middleware/validate.middleware";
import {
  imageConfirmSchema,
  imageReqParamSchema,
} from "../schema/images.schema";
import { requireAuth } from "../middleware/auth.middleware";

/**
 * Mounted under /upload/image, ahead of the parent's middleware, so nothing
 * here is reached by it: auth and every budget are declared below. That's the
 * point — minting a URL stands for an upload and spends that budget, confirming
 * has the confirm budget, and reading an image back re-signs at most once a
 * week, so it gets a read-sized budget instead.
 */
export const imagesRouter = new Hono();

imagesRouter.use("*", requireAuth);

imagesRouter.post(
  "/",
  uploadRateLimiter,
  imagesController.handleImageUploadUrl,
);

imagesRouter.post(
  "/confirm",
  uploadConfirmRateLimiter,
  validateReqBody(imageConfirmSchema),
  imagesController.handleImageConfirm,
);

imagesRouter.get(
  `/:${CTX_KEYS.imageUploadId}`,
  imageReadRateLimiter,
  validateReqParams(imageReqParamSchema),
  imagesController.handleGetImage,
);

imagesRouter.delete(
  `/:${CTX_KEYS.imageUploadId}`,
  imageReadRateLimiter,
  validateReqParams(imageReqParamSchema),
  imagesController.handleDeleteImage,
);
