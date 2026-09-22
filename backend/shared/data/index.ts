import { advisoryLock } from "./advisoryLock.data";
import { attachments } from "./attachments.data";
import { conversations } from "./conversations.data";
import { images } from "./images.data";
import { jobs } from "./jobs.data";
import { messageAttachmentLinks } from "./messageAttachmentLinks.data";
import { messages } from "./messages.data";
import { storageLedger } from "./storageLedger.data";
import { transcripts } from "./transcripts.data";
import { users } from "./users.data";

/** Every database operation, grouped by table: `data.<table>.<operation>()`. */
export const data = {
  advisoryLock,
  attachments,
  conversations,
  images,
  jobs,
  messageAttachmentLinks,
  messages,
  storageLedger,
  transcripts,
  users,
};

export type * from "./attachments.data";
export type * from "./conversations.data";
export type * from "./images.data";
export type * from "./jobs.data";
export type * from "./messages.data";
export type * from "./transcripts.data";
