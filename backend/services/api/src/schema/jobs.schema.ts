import { z } from "zod";
import { CTX_KEYS } from "../../../../shared/keys";
import {
  AudioTranscriptionJobs,
  jobStatusEnum,
  TextSummarizationJobs,
} from "../../../../shared/db";

export const jobReqParamSchema = z.object({
  [CTX_KEYS.uploadId]: z.string().uuid(),
});

const jobStatusValues = jobStatusEnum.enumValues;
export type JobStatus = (typeof jobStatusEnum.enumValues)[number];
type JobKindValues = ["text", "audio"];
const jobKindValues: JobKindValues = ["text", "audio"] as const;
export type JobKind = JobKindValues[number]; // "text" | "audio"

export type JobSummaries = {
  [K in JobKind]: K extends "text"
    ? (typeof TextSummarizationJobs.$inferSelect)[]
    : (typeof AudioTranscriptionJobs.$inferSelect)[];
};

/** Query params for the paginated history list (GET /jobs). */
export const jobsListQuerySchema = z.object({
  [CTX_KEYS.limit]: z.coerce.number().int().min(1).max(100).optional(),
  [CTX_KEYS.cursor]: z.string().min(1).optional(),
  [CTX_KEYS.status]: z.enum(jobStatusValues).optional(),
  [CTX_KEYS.kind]: z.enum(jobKindValues).optional(),
  [CTX_KEYS.q]: z.string().trim().min(1).optional(),
});

export const jobCursorSchema = z.object({
  createdAt: z.string(),
  uploadId: z.string(),
});
export type JobCursor = z.infer<typeof jobCursorSchema>;

/** Body for re-running a job's summarization with a different model. */
export const jobRerunBodySchema = z.object({
  [CTX_KEYS.chosenModelId]: z.string().min(1),
});
