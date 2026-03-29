import { FFmpeg } from "@ffmpeg/ffmpeg";
import { fetchFile } from "@ffmpeg/util";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

async function getFFmpeg(): Promise<FFmpeg> {
  if (ffmpeg?.loaded) return ffmpeg;
  if (!loadPromise) {
    const ff = new FFmpeg();
    loadPromise = (async () => {
      await ff.load({ coreURL, wasmURL });
      ffmpeg = ff;
      return ff;
    })();
  }
  return loadPromise;
}

/**
 * Demux/decodes video in-browser and returns a mono 16 kHz WAV for speech pipelines.
 * The original video bytes are not uploaded.
 */
export async function extractAudioFromVideo(
  videoFile: File,
): Promise<File> {
  const ff = await getFFmpeg();

  const extMatch = videoFile.name.match(/(\.[^.]+)$/);
  const ext = extMatch ? extMatch[1] : ".mp4";
  const inputName = `input${ext}`;
  const outputName = "extracted-audio.wav";

  await ff.writeFile(inputName, await fetchFile(videoFile));

  const code = await ff.exec([
    "-i",
    inputName,
    "-vn",
    "-ac",
    "1",
    "-ar",
    "16000",
    "-c:a",
    "pcm_s16le",
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
    throw new Error("Could not extract audio from this video.");
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

  const blob = new Blob([new Uint8Array(data)], { type: "audio/wav" });
  const base =
    videoFile.name.replace(/\.[^.]+$/, "").replace(/[^\w.-]+/g, "_") ||
    "recording";
  return new File([blob], `${base}-audio.wav`, { type: "audio/wav" });
}
