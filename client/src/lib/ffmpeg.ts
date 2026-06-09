import { FFmpeg } from "@ffmpeg/ffmpeg";
import coreURL from "@ffmpeg/core?url";
import wasmURL from "@ffmpeg/core/wasm?url";

let ffmpeg: FFmpeg | null = null;
let loadPromise: Promise<FFmpeg> | null = null;

export async function getFFmpeg(): Promise<FFmpeg> {
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

