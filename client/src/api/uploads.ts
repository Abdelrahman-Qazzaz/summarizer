import {
  uploadAudioEndpoint,
  uploadImageEndpoint,
  uploadYoutubeEndpoint,
} from "../config";
import { apiJson, jsonRequest } from "./http";

/**
 * Wire names for the multipart fields, mirroring the server's FORM_KEYS
 * (backend/shared/keys.ts). A field the server doesn't recognise is silently
 * dropped by the multipart validator, so these have to match exactly.
 */
const FORM_KEYS = {
  uploadFile: "uploadFile",
  audioSource: "audioSource",
  transcriptModelId: "transcriptModelId",
} as const;

export type UploadedImage = {
  imageUploadId: string;
  fileName: string;
  mimeType: string;
  size: number;
  signedUrl: string;
};

/** Stored immediately on drop; the signed URL is what previews the image. */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const body = new FormData();
  body.append(FORM_KEYS.uploadFile, file);
  return apiJson<UploadedImage>(uploadImageEndpoint(), {
    method: "POST",
    body,
  });
}

/** Deletes a resolved image removed from a draft. */
export async function deleteImage(imageUploadId: string): Promise<void> {
  await apiJson<{ message: string }>(
    `${uploadImageEndpoint()}/${imageUploadId}`,
    { method: "DELETE" },
  );
}

type UploadedAudio = {
  audioUploadId: string;
  fileName: string;
  size: number;
  mimeType: string | null;
  source: "audio" | "video";
};

/**
 * Speech audio — already extracted from video and compressed by the caller.
 * `source` records what it came from; the transcribe job is queued server-side.
 */
export async function uploadAudio(upload: {
  file: File;
  source: "audio" | "video";
  transcriptModelId: string;
}): Promise<UploadedAudio> {
  const body = new FormData();
  body.append(FORM_KEYS.uploadFile, upload.file);
  body.append(FORM_KEYS.audioSource, upload.source);
  body.append(FORM_KEYS.transcriptModelId, upload.transcriptModelId);
  return apiJson<UploadedAudio>(uploadAudioEndpoint(), {
    method: "POST",
    body,
  });
}

type QueuedYoutube = {
  audioUploadId: string;
  source: "youtube";
  url: string;
};

/** The audio is fetched and transcribed server-side — nothing leaves this device. */
export async function requestYoutubeTranscript(
  youtubeUrl: string,
  transcriptModelId: string,
): Promise<QueuedYoutube> {
  return apiJson<QueuedYoutube>(
    uploadYoutubeEndpoint(),
    jsonRequest("POST", {
      youtubeUrl,
      [FORM_KEYS.transcriptModelId]: transcriptModelId,
    }),
  );
}
