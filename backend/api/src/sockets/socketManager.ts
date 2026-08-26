import type { ServerType } from "@hono/node-server";
import { Server } from "socket.io";
import { parse } from "hono/utils/cookie";
import { COOKIE_KEYS } from "../../../shared/keys";
import { getApiEnv } from "../../../shared/env";
import { logger } from "../../../shared/logger";
import { verifySessionToken } from "../auth/sessionToken";

const log = logger.child({ component: "socket" });

/**
 * Attaches to the API's own HTTP server rather than listening on a port of its
 * own. Socket.IO claims the /socket.io/ path and the upgrade handshake; Hono
 * keeps everything else.
 *
 * One port is what nearly every host routes to a service, and it puts the
 * socket on the same origin as the API — so the browser needs no second URL,
 * and the session cookie authenticating the handshake is already in scope.
 */
export function startSocketServer(server: ServerType) {
  const io = new Server(server, {
    cors: {
      origin: getApiEnv().CLIENT_URL,
      credentials: true,
    },
  });
  io.use(async (socket, next) => {
    const raw = socket.handshake.headers.cookie;
    if (!raw) return next(new Error("Unauthorized"));
    const token = parse(raw)[COOKIE_KEYS.session];
    if (!token) return next(new Error("Unauthorized"));
    try {
      const { userId } = await verifySessionToken(token);
      // socket.data.userId = userId;
      socket.join(userId);
      next();
    } catch (error) {
      log.debug("Socket auth rejected", { error: String(error) });
      return next(new Error("Unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    log.info("Client connected", { socketId: socket.id });
    socket.on("disconnect", (reason) => {
      log.info("Client disconnected", { socketId: socket.id, reason });
    });
  });

  return io;
}
