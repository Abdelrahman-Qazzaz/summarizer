import { openai } from "./ai_client";

function audioFormat(blob: Blob): string {
  const mime = blob.type || "application/octet-stream";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mpeg") || mime.includes("mp3")) return "mp3";
  if (mime.includes("wav")) return "wav";
  if (mime.includes("ogg")) return "ogg";
  if (mime.includes("mp4") || mime.includes("m4a")) return "m4a";
  if (mime.includes("flac")) return "flac";
  throw new Error(`Unsupported audio type: ${mime}`);
}

type TranscriptionResponse = { text: string };

export async function transcribe(audio: Blob) {
  const format = audioFormat(audio);
  const base64 = Buffer.from(await audio.arrayBuffer()).toString("base64");

  const result = await openai.post<TranscriptionResponse>("/audio/transcriptions", {
    body: {
      model: "openai/gpt-4o-mini-transcribe",
      input_audio: { data: base64, format },
    },
  });

  return result.text;
}
