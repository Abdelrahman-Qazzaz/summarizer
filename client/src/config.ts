/** API origin without trailing slash. Empty = same origin (use Vite proxy in dev). */
export const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

/** WebSocket URL for job notifications (forward WS_PORT in dev containers). */
export function wsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return "ws://127.0.0.1:4000";
}

/** Socket.IO server URL (HTTP origin — Engine.IO handshake). */
export function socketIoUrl(): string {
  const ws = wsUrl();
  if (ws.startsWith("ws://")) return `http://${ws.slice("ws://".length)}`;
  if (ws.startsWith("wss://")) return `https://${ws.slice("wss://".length)}`;
  if (/^https?:\/\//i.test(ws)) return ws.replace(/\/$/, "");
  return "http://127.0.0.1:4000";
}

function uploadPath(suffix: "audio" | "text") {
  const path = `/upload/${suffix}`;
  return apiBase ? `${apiBase}${path}` : path;
}

export function uploadAudioEndpoint() {
  return uploadPath("audio");
}

export function uploadTextEndpoint() {
  return uploadPath("text");
}
