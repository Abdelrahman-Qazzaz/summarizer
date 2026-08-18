import type { Hono } from "hono";
import { etag } from "hono/etag";
import { createMiddleware } from "hono/factory";
import type { BlankEnv, BlankSchema } from "hono/types";

const addCacheHeaders = createMiddleware(async (context, next) => {
  await next(); // Wait for downstream middleware and the handler to create the response.

  const cacheable = context.res.status === 200 || context.res.status === 304;

  if (cacheable)
    context.res.headers.set(
      "Cache-Control",
      "private, max-age=300, stale-while-revalidate=86400",
    );
});

export function useHttpCache(router: Hono<BlankEnv, BlankSchema, "/">) {
  router.use("*", addCacheHeaders);
  router.use("*", etag()); // Finalize the ETag and 200/304 status before adding cache headers.
}
