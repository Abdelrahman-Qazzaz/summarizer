/** Dev host — keep API + WebSocket on the same hostname so session cookies are sent. */
const DEV_HOST = "localhost";

/** API origin without trailing slash (session cookies are set on this host). */
export const apiBase = (
  import.meta.env.VITE_API_URL ?? `http://${DEV_HOST}:3001`
).replace(/\/$/, "");

export function authLoginUrl(): string {
  return `${apiBase}/auth/login`;
}

export function authMeEndpoint(): string {
  return `${apiBase}/auth/me`;
}

export function authLogoutEndpoint(): string {
  return `${apiBase}/auth/logout`;
}

/** Backend splits job routes by pipeline: text → summarize, audio → transcribe. */
type JobKind = "text" | "audio";
function jobKindSegment(kind: JobKind): "summarize" | "transcribe" {
  return kind === "audio" ? "transcribe" : "summarize";
}

export function jobEndpoint(uploadId: string, kind: JobKind): string {
  return `${apiBase}/jobs/${jobKindSegment(kind)}/${uploadId}`;
}

export function jobsListEndpoint(): string {
  return `${apiBase}/jobs`;
}

export function jobRerunEndpoint(uploadId: string, kind: JobKind): string {
  return `${apiBase}/jobs/${jobKindSegment(kind)}/${uploadId}/rerun`;
}

export function modelsEndpoint(): string {
  return `${apiBase}/models`;
}

/** WebSocket URL for job notifications (forward WS_PORT in dev containers). */
export function wsUrl(): string {
  const fromEnv = import.meta.env.VITE_WS_URL;
  if (typeof fromEnv === "string" && fromEnv.trim()) {
    return fromEnv.trim();
  }
  return `ws://${DEV_HOST}:4000`;
}

/** Socket.IO server URL (HTTP origin — Engine.IO handshake). */
export function socketIoUrl(): string {
  const ws = wsUrl();
  if (ws.startsWith("ws://")) return `http://${ws.slice("ws://".length)}`;
  if (ws.startsWith("wss://")) return `https://${ws.slice("wss://".length)}`;
  if (/^https?:\/\//i.test(ws)) return ws.replace(/\/$/, "");
  return `http://${DEV_HOST}:4000`;
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
