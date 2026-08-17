import { useCallback, useContext, useSyncExternalStore } from "react";
import { SocketContext } from "./context";

/**
 * Whether job updates are arriving by push right now. Callers use it to decide
 * whether they need to poll at all — see useTranscriptWatcher. The socket is an
 * external store, so it's read as one rather than mirrored into state.
 */
export function useSocketConnected(): boolean {
  const socket = useContext(SocketContext);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (!socket) return () => undefined;
      socket.on("connect", onChange);
      socket.on("disconnect", onChange);
      return () => {
        socket.off("connect", onChange);
        socket.off("disconnect", onChange);
      };
    },
    [socket],
  );

  return useSyncExternalStore(
    subscribe,
    () => socket?.connected ?? false,
    () => false,
  );
}
