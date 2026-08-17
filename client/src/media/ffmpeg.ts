import { FFmpeg } from "@ffmpeg/ffmpeg";
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

let queue: Promise<unknown> = Promise.resolve();

/**
 * One FFmpeg instance serves the whole app, with one virtual filesystem and one
 * exec at a time — so dropping several recordings at once has to queue rather
 * than have each overwrite the others' input file mid-run. A failed job doesn't
 * hold up the next one.
 */
export function withFFmpeg<T>(task: (ff: FFmpeg) => Promise<T>): Promise<T> {
  const run = queue.then(
    () => getFFmpeg().then(task),
    () => getFFmpeg().then(task),
  );
  queue = run.catch(() => undefined);
  return run;
}
