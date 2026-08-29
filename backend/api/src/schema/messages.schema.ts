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

const messageAttachmentSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("image"),
    imageUploadId: z.string().uuid(),
  }),
  z.object({
    type: z.literal("transcript"),
    audioUploadId: z.string().uuid(),
  }),
]);

export type MessageAttachmentInput = z.infer<typeof messageAttachmentSchema>;

function attachmentUploadId(attachment: MessageAttachmentInput) {
  return attachment.type === "image"
    ? attachment.imageUploadId
    : attachment.audioUploadId;
}

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
    [CTX_KEYS.messageAttachments]: z
      .array(messageAttachmentSchema)
      .optional()
      .default([])
      .transform((attachments) => {
        const seenUploadIds = new Set<string>();
        return attachments.filter((attachment) => {
          const uploadId = attachmentUploadId(attachment);
          if (seenUploadIds.has(uploadId)) return false;
          seenUploadIds.add(uploadId);
          return true;
        });
      }),
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
    const imageCount = data[CTX_KEYS.messageAttachments].filter(
      (attachment) => attachment.type === "image",
    ).length;
    if (imageCount > MAX_ATTACHMENTS) {
      ctx.addIssue({
        code: "custom",
        message: "Too many attachments",
        path: [CTX_KEYS.messageAttachments],
      });
    }
    if (imageCount > 0 && !(await validateChatModelInput(modelId, "image"))) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid model: must accept image input",
        path: [CTX_KEYS.messageAttachments],
      });
    }
  });

/** PATCH replaces a stored user turn but accepts the same complete turn input. */
export const messagePatchBodySchema = messageCreateBodySchema;
