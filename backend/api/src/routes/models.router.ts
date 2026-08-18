import { Hono } from "hono";
import * as modelsController from "../controllers/models.controller";
import { modelRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { httpCache } from "../middleware/cache.middleware";

export const modelsRouter = new Hono();

modelsRouter.use("*", requireAuth, modelRateLimiter);

modelsRouter.use(
  "*",
  httpCache({
    maxAgeSeconds: 300,
    staleWhileRevalidateSeconds: 86_400,
  }),
);
modelsRouter.get("/chat", modelsController.handleGetModels);
modelsRouter.get("/transcription", modelsController.handleGetTranscribeModels);
