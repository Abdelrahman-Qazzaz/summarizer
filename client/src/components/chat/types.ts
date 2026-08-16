import type { MessageAttachment } from "../../lib/chat";

export type StagedImage = {
  localId: string;
  file: File;
  previewUrl: string;
  uploaded: MessageAttachment | null;
};

export type PendingTurn = {
  content: string;
  attachments: MessageAttachment[];
  audioFileName: string | null;
  assistantContent: string;
};
