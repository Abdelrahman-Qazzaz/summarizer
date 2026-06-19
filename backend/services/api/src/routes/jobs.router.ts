import { Hono } from "hono";
import * as jobsController from "../controllers/jobs.controller";
import { jobRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { validateParam } from "../middleware/validate.middleware";
import { CTX_KEYS } from "../../../../shared/keys";
import { jobReqParamSchema } from "../schema/jobs.schema";

export const jobsRouter = new Hono();

jobsRouter.use("*", requireAuth, jobRateLimiter);

jobsRouter.get(
  `/:${CTX_KEYS.uploadId}`,
  validateParam(jobReqParamSchema),
  jobsController.handleGetJob,
);
