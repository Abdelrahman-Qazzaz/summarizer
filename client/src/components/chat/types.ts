import type { MessageTranscript } from "../../api/messages";

export type TurnImage = {
  uploadId: string;
  fileName: string;
  url: string;
};

/**
 * The turn being answered right now. It stands in for the pair the server will
 * persist, so the conversation reads the same before and after the refetch.
 */
export type PendingTurn = {
  content: string;
  images: TurnImage[];
  transcripts: MessageTranscript[];
  assistantContent: string;
};
