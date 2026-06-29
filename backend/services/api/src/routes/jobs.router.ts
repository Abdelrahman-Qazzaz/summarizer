import { Hono } from "hono";
import * as jobsController from "../controllers/jobs.controller";
import { jobRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import {
  validateReqParams,
  validateReqQuery,
  validateReqBody,
} from "../middleware/validate.middleware";
import { CTX_KEYS } from "../../../../shared/keys";
import {
  jobReqParamSchema,
  jobsListQuerySchema,
  jobRerunBodySchema,
  jobTranscribeRerunBodySchema,
} from "../schema/jobs.schema";

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

jobsRouter.delete(
  `/transcribe/:${CTX_KEYS.uploadId}`,
  validateReqParams(jobReqParamSchema),
  jobsController.handleDeleteTranscribeJob,
);
jobsRouter.delete(
  `/summarize/:${CTX_KEYS.uploadId}`,
  validateReqParams(jobReqParamSchema),
  jobsController.handleDeleteSummarizeJob,
);

jobsRouter.post(
  `/transcribe/:${CTX_KEYS.uploadId}/rerun`,
  validateReqParams(jobReqParamSchema),
  validateReqBody(jobTranscribeRerunBodySchema),
  jobsController.handleRerunTranscribeJob,
);
jobsRouter.post(
  `/summarize/:${CTX_KEYS.uploadId}/rerun`,
  validateReqParams(jobReqParamSchema),
  validateReqBody(jobRerunBodySchema),
  jobsController.handleRerunSummarizeJob,
);

jobsRouter.get(
  "/",
  validateReqQuery(jobsListQuerySchema),
  jobsController.getUserJobs,
);
