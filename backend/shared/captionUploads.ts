import { jobs } from "./data/jobs.data";
import { deleteObjects } from "./uploads";

/**
 * Removes the caption text a finished job no longer needs. The job stops
 * pointing at it and the text is marked deleted together, so a failed storage
 * delete is left to the sweep rather than forgotten.
 */
export async function cleanupTerminalCaptionUpload(
  audioUploadId: string,
  userId?: string,
) {
  const upload = await jobs.findTerminalCaptionUpload(audioUploadId, userId);
  if (!upload?.captionUploadId) return false;

  const cleared = await jobs.clearCaptionUploadId(
    audioUploadId,
    upload.captionUploadId,
    upload.userId,
  );
  if (!cleared) return false;

  await deleteObjects(upload.userId, [
    { kind: "text", uploadId: upload.captionUploadId },
  ]);
  return true;
}
