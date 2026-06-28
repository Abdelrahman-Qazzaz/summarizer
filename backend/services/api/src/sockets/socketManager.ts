import { Server } from "socket.io";
import { parse } from "hono/utils/cookie";
import { verify } from "hono/jwt";
import { COOKIE_KEYS } from "../../../../shared/keys";
import { getApiEnv } from "../../../../shared/env";
import { logger } from "../../../../shared/logger";

const log = logger.child({ component: "socket" });
const port = getApiEnv().WS_PORT;
export function startSocketServer() {
  const io = new Server(port, {
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
      const payload = await verify(token, getApiEnv().SESSION_SECRET, "HS256");
      const userId = payload.sub;
      if (typeof userId !== "string") return next(new Error("Unauthorized"));
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
