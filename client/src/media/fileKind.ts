/**
 * What a dropped or picked file becomes. Images ride along as vision input;
 * audio and video both end up as transcripts, video after the audio track is
 * extracted in the browser.
 */
export type FileKind = "image" | "audio" | "video";

const VIDEO_EXTENSIONS = new Set([
  ".mp4",
  ".webm",
  ".mov",
  ".mkv",
  ".avi",
  ".m4v",
  ".mpeg",
  ".mpg",
]);

const AUDIO_EXTENSIONS = new Set([
  ".mp3",
  ".wav",
  ".m4a",
  ".aac",
  ".ogg",
  ".flac",
  ".webm",
  ".opus",
  ".weba",
]);

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".bmp",
  ".heic",
]);

export const IMAGE_ACCEPT = "image/*,.png,.jpg,.jpeg,.gif,.webp,.avif";
export const MEDIA_ACCEPT =
  "audio/*,video/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.opus,.weba,.mp4,.webm,.mov,.mkv,.avi,.m4v";

/** Mirrors the server's caps (backend/shared/bucket.ts) for instant feedback. */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 100 * 1024 * 1024;

/** Images one turn may carry — MAX_ATTACHMENTS in messages.schema.ts. */
export const MAX_IMAGES_PER_MESSAGE = 6;

function fileExtension(name: string): string {
  const match = name.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : "";
}

/** Null for anything the pipeline has no route for — the caller says so by name. */
export function classifyFile(file: File): FileKind | null {
  const type = file.type.toLowerCase();
  const extension = fileExtension(file.name);

  if (type.startsWith("image/") || IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  // Checked before audio so a video container with an audio-ish extension
  // (.webm is both) still takes the extract path.
  if (type.startsWith("video/")) return "video";
  if (type.startsWith("audio/")) return "audio";
  if (VIDEO_EXTENSIONS.has(extension)) return "video";
  if (AUDIO_EXTENSIONS.has(extension)) return "audio";
  return null;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
