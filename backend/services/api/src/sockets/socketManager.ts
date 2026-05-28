import { Server } from "socket.io";
import { getApiEnv } from "../../../../shared/env";

export async function startSocketServer() {
  const port = getApiEnv().WS_PORT;

  const io = new Server(port, {
    cors: {
      origin: "*", // TODO: fix this
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("Client connected:", socket.id);

    socket.on("disconnect", (reason) => {
      console.log("Client disconnected:", socket.id, reason);
    });
  });

  return io;
}
