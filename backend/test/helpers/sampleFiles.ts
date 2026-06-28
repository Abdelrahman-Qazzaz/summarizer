import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const SAMPLE_DIR = new URL("../sample/", import.meta.url);

/** Loads a file from test/sample as a `File`, preserving its real bytes. */
export async function loadSampleFile(name: string, type: string): Promise<File> {
  const buffer = await readFile(fileURLToPath(new URL(name, SAMPLE_DIR)));
  return new File([buffer], name, { type });
}

export const SAMPLE_TEXT_NAME = "test.txt";
export const SAMPLE_AUDIO_NAME = "audio_speech.flac";
