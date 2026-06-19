import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { ZodSchema } from "zod";

export function validateParam<T extends Record<string, unknown>>(
  schema: ZodSchema<T>,
) {
  return createMiddleware(async (c, next) => {
    const result = schema.safeParse(c.req.param());
    if (!result.success) {
      return c.json({ message: "Invalid request parameters" }, 400);
    }
    for (const [key, value] of Object.entries(result.data)) {
      c.set(key, value);
    }
    await next();
  });
}
