import { Hono } from "hono";
import { etag } from "hono/etag";
import * as modelsController from "../controllers/models.controller";
import { modelRateLimiter } from "../middleware/rateLimit.middleware";
import { requireAuth } from "../middleware/auth.middleware";
import { createMiddleware } from "hono/factory";

export const modelsRouter = new Hono();

modelsRouter.use("*", requireAuth, modelRateLimiter);

/**
 * The catalogs are large, identical for every user, and change about daily,
 * but the client re-asked for them on every load. An ETag turns a repeat
 * request into a 304 with no body; `private` because the route is session-
 * scoped even though the payload isn't user-specific, and
 * stale-while-revalidate lets a warm client paint immediately and refresh
 * behind the scenes.
 *
 * Registered ahead of etag() on purpose: middleware post-phases unwind in
 * reverse, so this runs last and the header survives onto the 304 that etag()
 * substitutes. A 304 that dropped it would stop the browser caching the next
 * response at all.
 */
const addModelCacheHeaders = createMiddleware(async (context, next) => {
  await next(); // Wait for downstream middleware and the handler to create the response.

  const cacheable = context.res.status === 200 || context.res.status === 304;

  if (cacheable)
    context.res.headers.set(
      "Cache-Control",
      "private, max-age=300, stale-while-revalidate=86400",
    );
});

modelsRouter.use("*", addModelCacheHeaders);
modelsRouter.use("*", etag()); // Finalize the ETag and 200/304 status before adding cache headers.

modelsRouter.get("/chat", modelsController.handleGetModels);
modelsRouter.get("/transcription", modelsController.handleGetTranscribeModels);
