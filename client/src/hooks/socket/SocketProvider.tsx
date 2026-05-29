import { useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { socketIoUrl } from "../../config";
import { SocketContext } from "./context";

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket, setSocket] = useState<Socket | null>(null);

  useEffect(() => {
    const newSocket = io(socketIoUrl(), {
      transports: ["websocket"],
      autoConnect: true,
      withCredentials: true,
    });

    setSocket(newSocket);

    return () => {
      newSocket.disconnect();
    };
  }, []);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
