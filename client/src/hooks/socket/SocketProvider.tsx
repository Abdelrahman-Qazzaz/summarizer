import { useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { socketIoUrl } from "../../config";
import { SocketContext } from "./context";

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  function attachListeners(socket: Socket) {
    socket.on("message", (d) => {
      console.log(d);
    });
  }
  useEffect(() => {
    const newSocket = io(socketIoUrl(), {
      transports: ["websocket"],
      autoConnect: true,
      auth: { token: localStorage.getItem("token") },
      withCredentials: true,
    });

    attachListeners(newSocket);
    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
