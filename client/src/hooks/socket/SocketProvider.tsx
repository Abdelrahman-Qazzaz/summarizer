import { useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { socketIoUrl } from "../../config";
import { SocketContext } from "./context";

export function SocketProvider({ children }: { children: ReactNode }) {
  // Create the socket once via a lazy state initializer; only tear it down on unmount.
  const [socket] = useState<Socket>(() =>
    io(socketIoUrl(), {
      transports: ["websocket"],
      autoConnect: true,
      withCredentials: true,
    }),
  );

  useEffect(() => {
    // Reconnect on (re)mount — covers StrictMode's mount→unmount→remount in dev.
    socket.connect();
    return () => {
      socket.disconnect();
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
