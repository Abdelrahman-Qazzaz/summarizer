import { Hono } from "hono";
import * as jobsController from "../controllers/jobs.controller";
import { jobRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { validateReqParams } from "../middleware/validate.middleware";
import { CTX_KEYS } from "../../../../shared/keys";
import { jobReqParamSchema } from "../schema/jobs.schema";

export const jobsRouter = new Hono();

jobsRouter.use("*", requireAuth, jobRateLimiter);

jobsRouter.get(
  `/transcribe/:${CTX_KEYS.uploadId}`,
  validateReqParams(jobReqParamSchema),
  jobsController.handleGetTranscribeJob,
);

jobsRouter.get(
  `/summarize/:${CTX_KEYS.uploadId}`,
  validateReqParams(jobReqParamSchema),
  jobsController.handleGetSummarizeJob,
);

jobsRouter.get("/", jobsController.getUserJobs);
