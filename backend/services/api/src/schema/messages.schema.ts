import { z } from "zod";
import { CTX_KEYS } from "../../../../shared/keys";
import { validateModel } from "../../../../shared/ai/ai_client";

export const MAX_MESSAGE_LENGTH = 50_000;
export const MAX_MESSAGE_ATTACHMENTS = 5;

export const messageReqParamSchema = z.object({
  [CTX_KEYS.conversationId]: z.string().uuid(),
  [CTX_KEYS.messageId]: z.string().uuid(),
});

/** An item referenced on a chat message. Only "image" exists today. */
//TODO: add 'transcripts' to messageAttachmentSchema
const messageAttachmentSchema = z.object({
  kind: z.literal("image"),
  uploadId: z.string().min(1),
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
      .max(MAX_MESSAGE_ATTACHMENTS, "Too many attachments")
      .optional()
      .default([]),
  })
  .superRefine(async (data, ctx) => {
    if (!(await validateModel(data[CTX_KEYS.chosenModelId], "text"))) {
      ctx.addIssue({
        code: "custom",
        message: "Invalid model: must be a text model",
        path: [CTX_KEYS.chosenModelId],
      });
    }
  });
