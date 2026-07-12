/** File-backed modes — drive the accept/extension helpers below. */
export type SourceMode = "text" | "video" | "audio";

/** Everything the upload form can stage; youtube takes a URL, not a file. */
export type UploadMode = SourceMode | "youtube";

// Mirrors the backend's YOUTUBE_HOSTS (upload.schema.ts) for instant client
// feedback — the server remains the authority.
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

export function isYoutubeUrl(raw: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

const TEXT_EXTENSIONS = new Set([".txt", ".md", ".markdown", ".text", ".pdf"]);
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

const TEXT_ACCEPT =
  ".txt,.md,.markdown,.text,.pdf,text/plain,text/markdown,application/pdf";
const VIDEO_ACCEPT = "video/*,.mp4,.webm,.mov,.mkv,.avi,.m4v,.mpeg,.mpg";
const AUDIO_ACCEPT = "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm,.opus,.weba";

function fileExtension(name: string): string {
  const match = name.match(/\.[^.]+$/);
  return match ? match[0].toLowerCase() : "";
}

export function acceptForMode(mode: SourceMode): string {
  if (mode === "text") return TEXT_ACCEPT;
  if (mode === "video") return VIDEO_ACCEPT;
  return AUDIO_ACCEPT;
}

export function isFileAcceptedForMode(file: File, mode: SourceMode): boolean {
  const ext = fileExtension(file.name);
  const type = file.type.toLowerCase();

  if (mode === "text") {
    if (TEXT_EXTENSIONS.has(ext)) return true;
    if (type === "application/pdf") return true;
    return type.startsWith("text/");
  }

  if (mode === "video") {
    if (type.startsWith("video/")) return true;
    return VIDEO_EXTENSIONS.has(ext);
  }

  // audio — reject video containers even if extension is .webm
  if (type.startsWith("video/")) return false;
  if (type.startsWith("audio/")) return true;
  return AUDIO_EXTENSIONS.has(ext);
}

export function rejectedFileMessage(mode: SourceMode): string {
  if (mode === "text") {
    return "Please choose a text or PDF file (.txt, .md, .pdf, …).";
  }
  if (mode === "video") {
    return "Please choose a video file (MP4, WebM, MOV, …).";
  }
  return "Please choose an audio file (MP3, WAV, M4A, …).";
}

export function dropZoneCopy(mode: SourceMode): {
  title: string;
  hint: string;
} {
  if (mode === "text") {
    return { title: "Drop a text or PDF file", hint: ".txt, .md, .pdf" };
  }
  if (mode === "video") {
    return { title: "Drop a video file", hint: "MP4, WebM, MOV, MKV" };
  }
  return { title: "Drop an audio file", hint: "MP3, WAV, M4A, OGG, FLAC" };
}
