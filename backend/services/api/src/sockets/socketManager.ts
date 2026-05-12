import { Server } from "socket.io";

const port = Number(process.env.WS_PORT) || 4000;

export const io = new Server(port, {
  cors: { origin: "*" },
});

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

});
