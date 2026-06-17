import { Hono } from "hono";
import * as modelsController from "../controllers/models.controller";
import { modelRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { redisCache } from "../middleware/cache.middleware";
import { CACHE_KEYS } from "../../../../shared/keys";

export const modelsRouter = new Hono();

modelsRouter.use("*", requireAuth, modelRateLimiter);

modelsRouter.get(
  "/",
  redisCache({ key: CACHE_KEYS.openRouterModels, ttlSeconds: 3600 }),
  modelsController.handleGetModels,
);
