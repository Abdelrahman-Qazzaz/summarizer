import { z } from "zod";
import { CTX_KEYS } from "../../../shared/keys";
import {
  validateChatModelInput,
  validateChatModelOutput,
} from "../../../shared/ai/ai_chat_client";

export const MAX_MESSAGE_LENGTH = 50_000;

/**
 * Images one turn may carry. Every attachment is handed to the model as vision
 * input, which is priced per image, so the cap is what keeps a single message
 * from being an unbounded bill.
 */
const MAX_ATTACHMENTS = 6;

export const messageReqParamSchema = z.object({
  [CTX_KEYS.conversationId]: z.string().uuid(),
  [CTX_KEYS.messageId]: z.string().uuid(),
});

/** Body for POST /conversations/:id/messages — the user turn to answer. */
export const messageCreateBodySchema = z
  .object({
    [CTX_KEYS.messageContent]: z
      .string()
      .trim()
      .min(1, "Message must not be empty")
      .max(MAX_MESSAGE_LENGTH, "Message is too long"),
    [CTX_KEYS.chosenModelId]: z.string().min(1),
    // ids from POST /upload/image. Deduped rather than rejected: the same image
    // twice in one turn is a client slip, not something to fail the send over.
    [CTX_KEYS.attachmentUploadIds]: z
      .array(z.string().uuid())
      .max(MAX_ATTACHMENTS, "Too many attachments")
      .optional()
      .default([])
      .transform((uploadIds) => [...new Set(uploadIds)]),
    // A completed transcription job whose transcript rides along with this
    // turn. One per turn: transcripts are large, and the character budget in
    // the controller would drop a second one anyway.
    [CTX_KEYS.audioUploadId]: z.string().uuid().optional(),
    [CTX_KEYS.lastMessageId]: z.string().uuid().nullable(),
  })
  .superRefine(async (data, ctx) => {
    const modelId = data[CTX_KEYS.chosenModelId];
    if (!(await validateChatModelOutput(modelId, "text"))) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid model: must be a text model",
        path: [CTX_KEYS.chosenModelId],
      });
      return;
    }
    if (
      data[CTX_KEYS.attachmentUploadIds].length > 0 &&
      !(await validateChatModelInput(modelId, "image"))
    ) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid model: must accept image input",
        path: [CTX_KEYS.chosenModelId],
      });
    }
  });
