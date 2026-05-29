import { Hono } from "hono";
import * as jobsController from "../controllers/jobs.controller";
import { requireAuth } from "../middleware/auth.middleware";

export const jobsRouter = new Hono();

jobsRouter.get("/:uploadId", requireAuth, jobsController.handleGetJob);
