import { jobEndpoint } from "../config";

export type JobStatus = "queued" | "processing" | "completed" | "failed";

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
  error: string | null;
};

export type Job = TextJob | AudioJob;

export async function fetchJob(uploadId: string): Promise<Job> {
  const res = await fetch(jobEndpoint(uploadId), { credentials: "include" });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    const message =
      data &&
      typeof data === "object" &&
      "message" in data &&
      typeof (data as { message: unknown }).message === "string"
        ? (data as { message: string }).message
        : res.statusText;
    throw new Error(message || `Failed to load job (${res.status})`);
  }
  if (!data || typeof data !== "object" || !("kind" in data)) {
    throw new Error("Invalid job response");
  }
  return data as Job;
}
