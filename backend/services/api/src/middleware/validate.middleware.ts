import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { ZodSchema } from "zod";
import type { ZodError } from "zod";
import { MAX_AUDIO_BYTES } from "../../../../shared/bucket";
const MAX_TEXT_BYTES = 15 * 1024 * 1024;

export function validateReqParams<T extends Record<string, unknown>>(
  schema: ZodSchema<T>,
) {
  return createMiddleware(async (c, next) => {
    const result = schema.safeParse(c.req.param());
    if (!result.success) {
      return c.json({ message: "Invalid request parameters" }, 400);
    }
    applyValidated(c, result.data);

    await next();
  });
}

export function validateReqBody<T extends Record<string, unknown>>(
  schema: ZodSchema<T>,
) {
  return createMiddleware(async (c, next) => {
    const body = await c.req.json().catch(() => null);
    // safeParseAsync (not safeParse) so schemas with async refinements — e.g.
    // youtubeUploadSchema validating models via validateModel — work here too.
    const result = await schema.safeParseAsync(body);
    if (!result.success) {
      // Surface the schema's own message (e.g. "Not a valid YouTube URL") the
      // way validateMultipart does; a generic string would make every custom
      // message in the schema dead code.
      const issue = result.error.issues[0];
      return c.json({ message: issue?.message ?? "Invalid request body" }, 400);
    }

    applyValidated(c, result.data);

    await next();
  });
}

export function validateReqQuery<T extends Record<string, unknown>>(
  schema: ZodSchema<T>,
) {
  return createMiddleware(async (c, next) => {
    const body = c.req.query();
    const result = schema.safeParse(body);
    if (!result.success)
      return c.json({ message: "Invalid request query" }, 400);

    applyValidated(c, result.data);

    await next();
  });
}

export function validateMultipart<T extends Record<string, unknown>>(
  schema: ZodSchema<T>,
  /** Form field names to read from multipart (wire names, e.g. "file", "model") */
  fields: readonly string[],
) {
  function multipartErrorResponse(c: Context, error: ZodError) {
    const issue = error.issues[0];
    const msg = issue?.message ?? "Invalid request body";
    if (msg === "Text file is too large") {
      return c.json({ message: msg, maxBytes: MAX_TEXT_BYTES }, 413);
    }
    if (msg === "Audio file is too large") {
      return c.json({ message: msg, maxBytes: MAX_AUDIO_BYTES }, 413);
    }
    return c.json({ message: msg }, 400);
  }
  return createMiddleware(async (c, next) => {
    let formData: FormData;
    try {
      formData = await c.req.formData();
    } catch {
      return c.json({ message: "Invalid multipart body" }, 400);
    }

    const raw: Record<string, unknown> = {};
    for (const name of fields) {
      raw[name] = formData.get(name); // File | string | null
    }

    const result = await schema.safeParseAsync(raw);
    if (!result.success) {
      return multipartErrorResponse(c, result.error);
    }

    applyValidated(c, result.data);
    await next();
  });
}
function applyValidated(c: Context, data: Record<string, unknown>) {
  for (const [key, value] of Object.entries(data)) c.set(key, value);
}
