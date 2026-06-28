import {
  jobEndpoint,
  jobRerunEndpoint,
  jobsListEndpoint,
} from "../config";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type JobKind = "text" | "audio";

export type TextJob = {
  kind: "text";
  uploadId: string;
  fileName: string;
  status: JobStatus;
  summary: string | null;
  error: string | null;
};

export type AudioJob = {
  kind: "audio";
  uploadId: string;
  fileName: string;
  status: JobStatus;
  transcript: string | null;
  /** Summary of the transcript, produced by the downstream summarize worker. */
  summary: string | null;
  /** Optional status of the downstream summarization step. */
  summaryStatus?: JobStatus | null;
  error: string | null;
};

export type Job = TextJob | AudioJob;

/** Lightweight job shape returned by the history list endpoint. */
export type JobSummary = {
  kind: JobKind;
  uploadId: string;
  fileName: string;
  status: JobStatus;
  createdAt: string;
  chosenModelId: string;
  error: string | null;
};

export type JobsListResponse = {
  jobs: JobSummary[];
  nextCursor: string | null;
};

export type JobsListParams = {
  limit?: number;
  cursor?: string | null;
  status?: JobStatus | null;
  kind?: JobKind | null;
  q?: string | null;
};

/** Pull a human-readable message out of an error response body. */
function messageFromBody(data: unknown, res: Response): string {
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as { message: unknown }).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return res.statusText;
}

async function parseJson(res: Response): Promise<unknown> {
  return res.json().catch(() => null);
}

export async function fetchJob(uploadId: string): Promise<Job> {
  const res = await fetch(jobEndpoint(uploadId), { credentials: "include" });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(messageFromBody(data, res) || `Failed to load job (${res.status})`);
  }
  if (!data || typeof data !== "object" || !("kind" in data)) {
    throw new Error("Invalid job response");
  }
  return data as Job;
}

export async function fetchJobs(
  params: JobsListParams = {},
): Promise<JobsListResponse> {
  const url = new URL(jobsListEndpoint());
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  if (params.status) url.searchParams.set("status", params.status);
  if (params.kind) url.searchParams.set("kind", params.kind);
  if (params.q) url.searchParams.set("q", params.q);

  const res = await fetch(url.toString(), { credentials: "include" });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(messageFromBody(data, res) || `Failed to load jobs (${res.status})`);
  }
  if (
    !data ||
    typeof data !== "object" ||
    !("jobs" in data) ||
    !Array.isArray((data as JobsListResponse).jobs)
  ) {
    throw new Error("Invalid jobs response");
  }
  const parsed = data as JobsListResponse;
  return { jobs: parsed.jobs, nextCursor: parsed.nextCursor ?? null };
}

export async function deleteJob(uploadId: string): Promise<void> {
  const res = await fetch(jobEndpoint(uploadId), {
    method: "DELETE",
    credentials: "include",
  });
  if (!res.ok) {
    const data = await parseJson(res);
    throw new Error(messageFromBody(data, res) || `Failed to delete job (${res.status})`);
  }
}

/** Re-run an existing upload with a different model. Returns the id to track. */
export async function rerunJob(
  uploadId: string,
  chosenModelId: string,
): Promise<string> {
  const res = await fetch(jobRerunEndpoint(uploadId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chosenModelId }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(messageFromBody(data, res) || `Failed to re-run job (${res.status})`);
  }
  if (
    data &&
    typeof data === "object" &&
    "uploadId" in data &&
    typeof (data as { uploadId: unknown }).uploadId === "string"
  ) {
    return (data as { uploadId: string }).uploadId;
  }
  // Fall back to the original id if the server doesn't echo a new one.
  return uploadId;
}
