import { Hono } from "hono";
import * as jobsController from "../controllers/jobs.controller";
import { jobRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";

export const jobsRouter = new Hono();

jobsRouter.use("*", requireAuth, jobRateLimiter);

jobsRouter.get("/:uploadId", jobsController.handleGetJob);
