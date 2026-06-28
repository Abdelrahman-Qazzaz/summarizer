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

type JobKindValues = ["text", "audio"];
const jobKindValues: JobKindValues = ["text", "audio"] as const;
type JobKind = JobKindValues[number]; // "text" | "audio"

export type JobSummaries = {
  [K in JobKind]: K extends "text"
    ? (typeof TextSummarizationJobs.$inferSelect)[]
    : (typeof AudioTranscriptionJobs.$inferSelect)[];
};

/** Query params for the paginated history list (GET /jobs). */
export const jobsListQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
  status: z.enum(jobStatusValues).optional(),
  kind: z.enum(jobKindValues).optional(),
  q: z.string().trim().min(1).optional(),
});

export const jobCursorSchema = z.object({
  createdAt: z.string(),
  uploadId: z.string(),
});
export type JobCursor = z.infer<typeof jobCursorSchema>;
