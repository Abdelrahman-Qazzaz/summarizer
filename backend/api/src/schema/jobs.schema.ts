import { z } from "zod";
import { CTX_KEYS } from "../../../shared/keys";
import { jobStatusEnum } from "../../../shared/db";
import { isValidTranscribeModel } from "../../../shared/ai/ai_transcribe_client";

export const jobReqParamSchema = z.object({
  [CTX_KEYS.audioUploadId]: z.string().uuid(),
});

const jobStatusValues = jobStatusEnum.enumValues;
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];

/** Query params for the paginated history list (GET /jobs). */
export const jobsListQuerySchema = z.object({
  [CTX_KEYS.limit]: z.coerce.number().int().min(1).max(100).optional(),
  [CTX_KEYS.cursor]: z.string().min(1).optional(),
  [CTX_KEYS.status]: z.enum(jobStatusValues).optional(),
  [CTX_KEYS.q]: z.string().trim().min(1).optional(),
});

export const jobCursorSchema = z.object({
  createdAt: z.string(),
  audioUploadId: z.string(),
});

/** Body for re-running an audio job with a different transcription model. */
export const jobTranscribeRerunBodySchema = z
  .object({
    [CTX_KEYS.transcriptModelId]: z.string().min(1),
  })
  .superRefine(async (data, ctx) => {
    if (!(await isValidTranscribeModel(data[CTX_KEYS.transcriptModelId]))) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid transcription model",
        path: [CTX_KEYS.transcriptModelId],
      });
    }
  });
