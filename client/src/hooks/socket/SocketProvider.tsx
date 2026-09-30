import { useEffect, useState, type ReactNode } from "react";
import { io, type Socket } from "socket.io-client";
import { refreshSession } from "../../api/session";
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

  // The handshake is authenticated by the session cookie, whose access token
  // may have expired by the time the socket reconnects. Socket.IO doesn't
  // retry a handshake the server refused, so this refreshes and reconnects.
  // It does so once until the socket next connects, so a session the server
  // keeps refusing can't loop.
  useEffect(() => {
    let retried = false;
    const onConnect = () => {
      retried = false;
    };
    const onConnectError = (error: Error) => {
      // Still active means a network failure Socket.IO retries by itself.
      if (socket.active || error.message !== "Unauthorized" || retried) return;
      retried = true;
      refreshSession()
        .then((session) => {
          if (session) socket.connect();
        })
        .catch(() => undefined);
    };
    socket.on("connect", onConnect);
    socket.on("connect_error", onConnectError);
    return () => {
      socket.off("connect", onConnect);
      socket.off("connect_error", onConnectError);
    };
  }, [socket]);

  return (
    <SocketContext.Provider value={socket}>{children}</SocketContext.Provider>
  );
}
