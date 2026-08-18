const env = getApiEnv();

import { getApiEnv } from "../shared/env";
import { startSocketServer } from "./src/sockets/socketManager";

import { mq } from "../shared/message-queue/messageQueue";
import { failAudioJobById } from "../shared/data/jobs.data";
import { onShutdown } from "../shared/shutdown";

import { serve } from "@hono/node-server";
import { createApp } from "./app";

// createApp() runs the fail-fast preflight: if any third-party dependency is
// down (incl. RabbitMQ, which it also connects), the API never starts.
const app = await createApp();
export const port = env.PORT;

// Listening starts here; the socket server then attaches to this same server,
// so the API and the websocket share one port.
const server = serve({ fetch: app.fetch, port });
export const io = startSocketServer(server);

const cancelConsumers = await Promise.all([
  mq.consume(mq.queues.TRANSCRIBE_DONE, ({ uploadId, userId }) => {
    io.to(userId).emit("jobUpdated", { uploadId });
  }),
  // youtube-fetcher couldn't download/upload the audio: mark the job failed and
  // notify the user. The row was created by POST /upload/youtube.
  mq.consume(mq.queues.YT_FETCH_FAILED, async ({ uploadId, userId, error }) => {
    await failAudioJobById(uploadId, error ?? "Failed to fetch YouTube audio");
    io.to(userId).emit("jobUpdated", { uploadId });
  }),
]);

/**
 * Stop taking work, then let go of the connections.
 *
 * A reply streaming when this fires is not lost: the model run is deliberately
 * decoupled from the response stream, so the turn still completes and is
 * stored, and the client refetches it. The conversation claim it holds is
 * covered by its lease, so even a hard kill frees the conversation rather than
 * locking it.
 */
onShutdown(async () => {
  await Promise.all(cancelConsumers.map((cancel) => cancel()));
  // io owns the HTTP server it was attached to, so closing it closes both.
  // The second close is a belt-and-braces no-op and must not reject on
  // "server is not running".
  await new Promise<void>((resolve) => io.close(() => resolve()));
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await mq.close();
});
