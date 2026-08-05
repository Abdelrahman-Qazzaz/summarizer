import { Hono } from "hono";
import * as messagesController from "../controllers/messages.controller";
import {
  validateReqParams,
  validateReqBody,
} from "../middleware/validate.middleware";
import { CTX_KEYS } from "../../../shared/keys";
import { conversationReqParamSchema } from "../schema/conversations.schema";
import {
  messageReqParamSchema,
  messageCreateBodySchema,
} from "../schema/messages.schema";

export const messagesRouter = new Hono();

messagesRouter.get(
  "/",
  validateReqParams(conversationReqParamSchema),
  messagesController.handleListMessages,
);

messagesRouter.post(
  "/",
  validateReqParams(conversationReqParamSchema),
  validateReqBody(messageCreateBodySchema),
  messagesController.handleCreateMessage,
);

messagesRouter.delete(
  `/:${CTX_KEYS.messageId}`,
  validateReqParams(messageReqParamSchema),
  messagesController.handleDeleteMessage,
);

// TODO: add patch message
