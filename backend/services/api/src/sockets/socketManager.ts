import { Server } from "socket.io";
import { parse } from "hono/utils/cookie";
import { verify } from "hono/jwt";
import { COOKIE_KEYS } from "../cookies/keys";
import { getApiEnv } from "../../../../shared/env";

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
    } catch {
      return next(new Error("Unauthorized"));
    }
  });
  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("disconnect", (reason) => {
      console.log("Client disconnected:", socket.id, reason);
    });
  });

  return io;
}
