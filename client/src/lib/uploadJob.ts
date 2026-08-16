import {
  uploadAudioEndpoint,
  uploadYoutubeEndpoint,
} from "../config";
import { extractAudioFromVideo } from "./extractAudio";
import { compressAudioForSpeech } from "./compressAudio";
import type { SourceMode } from "../sourceMode";

export type UploadPhase = "extract" | "compress" | "upload";

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

function uploadIdFromBody(data: unknown): string | null {
  if (
    data &&
    typeof data === "object" &&
    "uploadId" in data &&
    typeof (data as { uploadId: unknown }).uploadId === "string"
  ) {
    return (data as { uploadId: string }).uploadId;
  }
  return null;
}

export async function runUpload(
  file: File,
  mode: SourceMode,
  transcriptionModelId: string,
  onPhase: (phase: UploadPhase) => void,
): Promise<string> {
  const body = new FormData();
  let uploadFile = file;
  if (mode === "video") {
    onPhase("extract");
    uploadFile = await extractAudioFromVideo(file);
  }
  onPhase("compress");
  uploadFile = await compressAudioForSpeech(uploadFile);
  onPhase("upload");
  body.append("uploadFile", uploadFile);
  body.append("audioSource", mode);
  body.append("transcriptionModelId", transcriptionModelId);

  const res = await fetch(uploadAudioEndpoint(), {
    method: "POST",
    body,
    credentials: "include",
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      messageFromBody(data, res) || `Upload failed (${res.status})`,
    );
  }
  const uploadId = uploadIdFromBody(data);
  if (!uploadId) {
    throw new Error("Upload succeeded but no job id was returned.");
  }
  return uploadId;
}

export async function runYoutubeUpload(
  url: string,
  transcriptionModelId: string,
): Promise<string> {
  const res = await fetch(uploadYoutubeEndpoint(), {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      youtubeUrl: url,
      transcriptionModelId,
    }),
  });
  const data: unknown = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(
      messageFromBody(data, res) || `Upload failed (${res.status})`,
    );
  }
  const uploadId = uploadIdFromBody(data);
  if (!uploadId) {
    throw new Error("Upload succeeded but no job id was returned.");
  }
  return uploadId;
}
