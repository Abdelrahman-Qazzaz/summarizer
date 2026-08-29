import { jobEndpoint, jobRerunEndpoint, jobsListEndpoint } from "../config";
import { apiFetch, apiJson, jsonRequest } from "./http";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type Job = {
  audioUploadId: string;
  fileName: string;
  status: JobStatus;
  transcript: string | null;
  error: string | null;
};

/** What the paginated list returns — no transcript body. */
export type JobSummary = {
  audioUploadId: string;
  fileName: string;
  status: JobStatus;
  createdAt: string;
  error: string | null;
};

export type JobsPage = {
  jobs: JobSummary[];
  nextCursor: string | null;
};

export type JobsFilters = {
  status?: JobStatus | null;
  q?: string | null;
};

export async function fetchJob(audioUploadId: string): Promise<Job> {
  const data = await apiJson<Job>(jobEndpoint(audioUploadId));
  if (!data?.audioUploadId) throw new Error("Invalid job response");
  return data;
}

export async function fetchJobs(
  params: JobsFilters & { limit?: number; cursor?: string | null } = {},
): Promise<JobsPage> {
  const url = new URL(jobsListEndpoint());
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  if (params.status) url.searchParams.set("status", params.status);
  if (params.q) url.searchParams.set("q", params.q);

  const data = await apiJson<JobsPage>(url.toString());
  if (!Array.isArray(data?.jobs)) throw new Error("Invalid jobs response");
  return { jobs: data.jobs, nextCursor: data.nextCursor ?? null };
}

export async function deleteJob(audioUploadId: string): Promise<void> {
  await apiFetch(jobEndpoint(audioUploadId), { method: "DELETE" });
}

/** Transcribe the same audio again with another model, replacing the transcript. */
export async function rerunJob(
  audioUploadId: string,
  transcriptModelId: string,
): Promise<string> {
  const data = await apiJson<{ audioUploadId: string }>(
    jobRerunEndpoint(audioUploadId),
    jsonRequest("POST", { transcriptModelId }),
  );
  return data.audioUploadId ?? audioUploadId;
}
