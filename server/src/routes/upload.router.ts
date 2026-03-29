import { Hono } from "hono";
import * as uploadController from "../controllers/upload.controller";

export const uploadRouter = new Hono();

uploadRouter.post("/audio", uploadController.handleAudioUpload);
uploadRouter.post("/text", uploadController.handleTextUpload);
