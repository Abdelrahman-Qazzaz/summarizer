import { z } from "zod";
import { CTX_KEYS } from "../../../../shared/keys";

export const MAX_MESSAGE_LENGTH = 50_000;

export const messageReqParamSchema = z.object({
  [CTX_KEYS.conversationId]: z.string().uuid(),
  [CTX_KEYS.messageId]: z.string().uuid(),
});

/** Body for POST /conversations/:id/messages — the user turn to answer. */
export const messageCreateBodySchema = z.object({
  [CTX_KEYS.messageContent]: z
    .string()
    .trim()
    .min(1, "Message must not be empty")
    .max(MAX_MESSAGE_LENGTH, "Message is too long"),
  [CTX_KEYS.chosenModelId]: z.string().min(1),
});
