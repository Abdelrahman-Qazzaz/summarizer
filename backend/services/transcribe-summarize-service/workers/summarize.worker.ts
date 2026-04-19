import type { UploadId } from "../../../shared/types/mq.types";

export async function handleSummarize(uploadId: UploadId) {
  console.log("summarizing:", uploadId);
}
