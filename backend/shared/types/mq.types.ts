export type UploadId = `${string}-${string}-${string}-${string}-${string}`;

export type TranscribeEvent = {
  uploadId: UploadId;
};

export type SummarizeEvent = {
  uploadId: UploadId;
};
