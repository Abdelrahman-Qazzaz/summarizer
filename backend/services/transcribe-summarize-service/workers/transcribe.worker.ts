import type { UploadId } from "../../../shared/types/mq.types";

export async function handleTranscribe(uploadId: UploadId) {
  console.log("transcribing:", uploadId);
}
