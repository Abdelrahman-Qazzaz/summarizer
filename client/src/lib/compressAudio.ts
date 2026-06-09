import { fetchFile } from "@ffmpeg/util";
import { getFFmpeg } from "./ffmpeg";

type CompressOptions = {
  /** Opus bitrate in kbps (speech: ~16–48). */
  bitrateKbps?: number;
  /** Sample rate for speech pipelines (default 16000). */
  sampleRate?: number;
  /** Channels (default mono). */
  channels?: 1 | 2;
};

/**
 * Compress any audio file (video-derived or direct audio) into a speech-friendly
 * Opus-in-WebM: mono, 16 kHz, low bitrate.
 */
export async function compressAudioForSpeech(
  audioFile: File,
  opts?: CompressOptions,
): Promise<File> {
  const ff = await getFFmpeg();

  const bitrateKbps = opts?.bitrateKbps ?? 24;
  const sampleRate = opts?.sampleRate ?? 16000;
  const channels = opts?.channels ?? 1;

  const extMatch = audioFile.name.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : ".bin";
  const inputName = `input${ext}`;

  const base =
    audioFile.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") || "audio";
  const outputName = "speech-audio.webm";

  await ff.writeFile(inputName, await fetchFile(audioFile));

  const code = await ff.exec([
    "-i",
    inputName,
    "-vn",
    "-ac",
    String(channels),
    "-ar",
    String(sampleRate),
    "-c:a",
    "libopus",
    "-b:a",
    `${bitrateKbps}k`,
    "-application",
    "voip",
    outputName,
  ]);

  try {
    await ff.deleteFile(inputName);
  } catch {
    /* ignore */
  }

  if (code !== 0) {
    try {
      await ff.deleteFile(outputName);
    } catch {
      /* ignore */
    }
    throw new Error("Could not compress audio.");
  }

  const data = await ff.readFile(outputName);
  try {
    await ff.deleteFile(outputName);
  } catch {
    /* ignore */
  }

  if (typeof data === "string") {
    throw new Error("Unexpected text output from ffmpeg.");
  }

  const mime = "audio/webm";
  const blob = new Blob([new Uint8Array(data)], { type: mime });
  return new File([blob], `${base}-speech.webm`, { type: mime });
}

