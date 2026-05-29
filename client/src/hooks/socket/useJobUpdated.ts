import { useContext, useEffect } from "react";
import { SocketContext } from "./context";

type JobUpdatedPayload = {
  uploadId: string;
};

export function useJobUpdated(
  enabled: boolean,
  activeUploadId: string | null,
  onJobUpdated: (uploadId: string) => void,
) {
  const socket = useContext(SocketContext);

  useEffect(() => {
    if (!enabled || !socket || !activeUploadId) return;

    const handler = ({ uploadId }: JobUpdatedPayload) => {
      if (uploadId === activeUploadId) onJobUpdated(uploadId);
    };

    socket.on("jobUpdated", handler);
    return () => {
      socket.off("jobUpdated", handler);
    };
  }, [enabled, socket, activeUploadId, onJobUpdated]);
}
