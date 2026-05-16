import { Server } from "socket.io";

export async function startSocketServer() {
  const port = Number(process.env.WS_PORT) || 4000;

  const io = new Server(port, {
    cors: {
      origin: process.env.CORS_ORIGIN?.split(",") ?? [],
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