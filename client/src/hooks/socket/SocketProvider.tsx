import { useEffect, useState, type ReactNode } from "react";
import { io } from "socket.io-client";
import { socketIoUrl } from "../../config";
import { SocketContext } from "./context";

export function SocketProvider({ children }: { children: ReactNode }) {
  const [socket] = useState(
    () =>
      io(socketIoUrl(), {
        transports: ["websocket"],
      }),
  );

  useEffect(() => {
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
