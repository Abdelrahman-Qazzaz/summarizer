import { deleteFilesFromBucket } from "./bucket";
import {
  clearCaptionUploadId,
  findTerminalCaptionUpload,
} from "./data/jobs.data";

export async function cleanupTerminalCaptionUpload(
  audioUploadId: string,
  userId?: string,
) {
  const upload = await findTerminalCaptionUpload(audioUploadId, userId);
  if (!upload?.captionUploadId) return false;

  await deleteFilesFromBucket(upload.userId, [upload.captionUploadId]);
  await clearCaptionUploadId(audioUploadId, upload.captionUploadId);
  return true;
}
