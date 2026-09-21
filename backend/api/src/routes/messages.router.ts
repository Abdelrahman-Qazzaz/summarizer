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
import { httpCache } from "../middleware/cache.middleware";

export const messagesRouter = new Hono();

messagesRouter.get(
  "/",
  validateReqParams(conversationReqParamSchema),
  httpCache({ revalidate: true }),
  messagesController.handleListMessages,
);

messagesRouter.delete(
  `/:${CTX_KEYS.messageId}`,
  validateReqParams(messageReqParamSchema),
  messagesController.handleDeleteMessage,
);

messagesRouter.post(
  "/",
  validateReqParams(conversationReqParamSchema),
  validateReqBody(messageCreateBodySchema),
  messagesController.handleCreateMessage,
);

messagesRouter.patch(
  `/:${CTX_KEYS.messageId}`,
  validateReqParams(messageReqParamSchema),
  validateReqBody(messageCreateBodySchema),
  messagesController.handlePatchMessage,
);
