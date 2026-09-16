import {
  uploadAudioConfirmEndpoint,
  uploadAudioEndpoint,
  uploadImageConfirmEndpoint,
  uploadImageEndpoint,
  uploadYoutubeEndpoint,
} from "../config";
import { ApiError, apiJson, jsonRequest } from "./http";

/**
 * Wire names for the request fields, mirroring the server's FORM_KEYS
 * (backend/shared/keys.ts). A field the server doesn't recognise is silently
 * dropped by its validator, so these have to match exactly.
 */
const FORM_KEYS = {
  uploadId: "uploadId",
  fileName: "fileName",
  audioSource: "audioSource",
  transcriptModelId: "transcriptModelId",
} as const;

type UploadTarget = { uploadId: string; signedUploadUrl: string };

/**
 * Sends a file straight to storage: the API mints a URL bound to one storage
 * key, and the bytes go there without passing through the API.
 */
async function uploadToStorage(
  mintEndpoint: string,
  file: File,
): Promise<string> {
  const { uploadId, signedUploadUrl } = await apiJson<UploadTarget>(
    mintEndpoint,
    jsonRequest("POST", {}),
  );

  // Not apiFetch: storage is another origin and answers CORS with a wildcard,
  // which browsers refuse for credentialed requests. The URL's token is the
  // only authorization this request needs.
  const response = await fetch(signedUploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!response.ok) {
    throw new ApiError(
      "Could not upload the file. Please try again.",
      response.status,
      null,
    );
  }

  return uploadId;
}

export type UploadedImage = {
  imageUploadId: string;
  fileName: string;
  mimeType: string;
  size: number;
  signedUrl: string;
};

/** Stored immediately on drop; the signed URL is what previews the image. */
export async function uploadImage(file: File): Promise<UploadedImage> {
  const uploadId = await uploadToStorage(uploadImageEndpoint(), file);

  return apiJson<UploadedImage>(
    uploadImageConfirmEndpoint(),
    jsonRequest("POST", {
      [FORM_KEYS.uploadId]: uploadId,
      [FORM_KEYS.fileName]: file.name,
    }),
  );
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
  /** What storage holds, which the server reads back rather than trusting us. */
  size: number;
  mimeType: string;
  source: "audio" | "video";
};

/**
 * Speech audio — already extracted from video and compressed by the caller.
 * `source` records what it came from; the transcribe job is queued server-side
 * once the upload is confirmed.
 */
export async function uploadAudio(upload: {
  file: File;
  source: "audio" | "video";
  transcriptModelId: string;
}): Promise<UploadedAudio> {
  const uploadId = await uploadToStorage(uploadAudioEndpoint(), upload.file);

  return apiJson<UploadedAudio>(
    uploadAudioConfirmEndpoint(),
    jsonRequest("POST", {
      [FORM_KEYS.uploadId]: uploadId,
      [FORM_KEYS.fileName]: upload.file.name,
      [FORM_KEYS.audioSource]: upload.source,
      [FORM_KEYS.transcriptModelId]: upload.transcriptModelId,
    }),
  );
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
