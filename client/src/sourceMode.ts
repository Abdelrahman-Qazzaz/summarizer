export type SourceMode = "text" | "video" | "audio";

const TEXT_ACCEPT = ".txt,.md,.markdown,.text,text/plain";
const VIDEO_ACCEPT = "video/*";
const AUDIO_ACCEPT =
  "audio/*,.mp3,.wav,.m4a,.aac,.ogg,.flac,.webm";

export function acceptForMode(mode: SourceMode): string {
  if (mode === "text") return TEXT_ACCEPT;
  if (mode === "video") return VIDEO_ACCEPT;
  return AUDIO_ACCEPT;
}

export function dropZoneCopy(mode: SourceMode): {
  title: string;
  hint: string;
} {
  if (mode === "text") {
    return { title: "Drop a text file", hint: ".txt, .md, …" };
  }
  if (mode === "video") {
    return { title: "Drop a video file", hint: "MP4, WebM, …" };
  }
  return { title: "Drop an audio file", hint: "MP3, WAV, M4A, …" };
}
