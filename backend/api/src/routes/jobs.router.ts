import { Hono } from "hono";
import * as jobsController from "../controllers/jobs.controller";
import { jobRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import {
  validateReqParams,
  validateReqQuery,
  validateReqBody,
} from "../middleware/validate.middleware";
import { CTX_KEYS } from "../../../shared/keys";
import {
  jobReqParamSchema,
  jobsListQuerySchema,
  jobTranscribeRerunBodySchema,
} from "../schema/jobs.schema";
import { httpCache } from "../middleware/cache.middleware";

export const jobsRouter = new Hono();

jobsRouter.use("*", requireAuth, jobRateLimiter);

jobsRouter.get(
  `/transcribe/:${CTX_KEYS.audioUploadId}`,
  validateReqParams(jobReqParamSchema),
  httpCache({ revalidate: true }),
  jobsController.handleGetTranscribeJob,
);

jobsRouter.delete(
  `/transcribe/:${CTX_KEYS.audioUploadId}`,
  validateReqParams(jobReqParamSchema),
  jobsController.handleDeleteTranscribeJob,
);

jobsRouter.post(
  `/transcribe/:${CTX_KEYS.audioUploadId}/rerun`,
  validateReqParams(jobReqParamSchema),
  validateReqBody(jobTranscribeRerunBodySchema),
  jobsController.handleRerunTranscribeJob,
);

jobsRouter.get(
  "/",
  validateReqQuery(jobsListQuerySchema),
  jobsController.getUserJobs,
);
