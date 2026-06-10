import { Hono } from "hono";
import * as uploadController from "../controllers/upload.controller";
import { uploadRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";

export const uploadRouter = new Hono();

uploadRouter.use("*", requireAuth, uploadRateLimiter);

uploadRouter.post("/audio", uploadController.handleAudioUpload);
uploadRouter.post("/text", uploadController.handleTextUpload);
