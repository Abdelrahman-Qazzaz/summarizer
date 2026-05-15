import { useContext } from "react";
import type { Socket } from "socket.io-client";
import { SocketContext } from "./context";

export function useSocket(): Socket {
  const socket = useContext(SocketContext);
  if (!socket) throw new Error("Socket not initialized");
  return socket;
}
