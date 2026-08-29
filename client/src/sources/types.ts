export type SourceKind = "image" | "audio" | "video" | "youtube";

/**
 * A source's whole life, in order. Everything but `image` passes through
 * `transcribing`, which is the wait the composer blocks on: the API refuses a
 * turn that names a transcript the worker hasn't written yet.
 */
export type SourceStatus =
  "preparing" | "uploading" | "transcribing" | "ready" | "failed";

export type StagedSource = {
  localId: string;
  kind: SourceKind;
  name: string;
  status: SourceStatus;
  sourceUploadId: string | null;
  /** Object URL for image previews; revoked when the source is dropped. */
  previewUrl: string | null;
  charCount: number | null;
  error: string | null;
  /** Kept so a failed upload can be retried without re-picking the file. */
  file: File | null;
  youtubeUrl: string | null;
};

export function isTranscriptSource(source: StagedSource): boolean {
  return source.kind !== "image";
}

export function isSourceInFlight(source: StagedSource): boolean {
  return (
    source.status === "preparing" ||
    source.status === "uploading" ||
    source.status === "transcribing"
  );
}

const statusLabels: Record<SourceStatus, string> = {
  preparing: "preparing",
  uploading: "uploading",
  transcribing: "transcribing",
  ready: "ready",
  failed: "failed",
};

export function sourceStatusLabel(source: StagedSource): string {
  if (source.status === "ready" && source.charCount != null) {
    return `ready · ${source.charCount.toLocaleString()} chars`;
  }
  return statusLabels[source.status];
}
