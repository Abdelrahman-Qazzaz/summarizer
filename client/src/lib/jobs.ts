import { jobEndpoint, jobRerunEndpoint, jobsListEndpoint } from "../config";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

export type Job = {
  uploadId: string;
  fileName: string;
  status: JobStatus;
  transcript: string | null;
  error: string | null;
};

/** Lightweight job shape returned by the history list endpoint. */
export type JobSummary = {
  uploadId: string;
  fileName: string;
  status: JobStatus;
  createdAt: string;
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

function asJob(data: unknown): Job {
  if (!data || typeof data !== "object" || !("uploadId" in data)) {
    throw new Error("Invalid job response");
  }
  return data as Job;
}

export async function fetchJob(uploadId: string): Promise<Job> {
  const response = await fetch(jobEndpoint(uploadId), {
    credentials: "include",
  });
  const data = await parseJson(response);
  if (!response.ok) {
    throw new Error(
      messageFromBody(data, response) ||
        `Failed to load job (${response.status})`,
    );
  }
  return asJob(data);
}

export async function fetchJobs(
  params: JobsListParams = {},
): Promise<JobsListResponse> {
  const url = new URL(jobsListEndpoint());
  if (params.limit != null) url.searchParams.set("limit", String(params.limit));
  if (params.cursor) url.searchParams.set("cursor", params.cursor);
  if (params.status) url.searchParams.set("status", params.status);
  if (params.q) url.searchParams.set("q", params.q);

  const res = await fetch(url.toString(), { credentials: "include" });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(
      messageFromBody(data, res) || `Failed to load jobs (${res.status})`,
    );
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
    throw new Error(
      messageFromBody(data, res) || `Failed to delete job (${res.status})`,
    );
  }
}

export async function rerunJob(
  uploadId: string,
  transcriptionModelId: string,
): Promise<string> {
  const res = await fetch(jobRerunEndpoint(uploadId), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ transcriptionModelId }),
  });
  const data = await parseJson(res);
  if (!res.ok) {
    throw new Error(
      messageFromBody(data, res) || `Failed to re-run job (${res.status})`,
    );
  }
  if (
    data &&
    typeof data === "object" &&
    "uploadId" in data &&
    typeof (data as { uploadId: unknown }).uploadId === "string"
  ) {
    return (data as { uploadId: string }).uploadId;
  }
  return uploadId;
}
