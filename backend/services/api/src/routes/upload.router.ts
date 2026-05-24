import { Hono } from "hono";
import * as uploadController from "../controllers/upload.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const uploadRouter = new Hono();

uploadRouter.post("/audio", requireAuth, uploadController.handleAudioUpload);
uploadRouter.post("/text", requireAuth, uploadController.handleTextUpload);
