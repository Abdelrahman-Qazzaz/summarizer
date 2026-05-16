import type { UploadId } from "../../../shared/types/mq.types";

export async function handleTranscribeJob(uploadId: UploadId) {
  console.log("transcribing:", uploadId);
}
