import { z } from "zod";
import { CTX_KEYS } from "../../../../shared/keys";

export const jobReqParamSchema = z.object({
  [CTX_KEYS.uploadId]: z.string().uuid(),
});

// export const jobsReqBodySchema;
