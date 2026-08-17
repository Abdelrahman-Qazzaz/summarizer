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

export function jobEndpoint(uploadId: string): string {
  return `${apiBase}/jobs/transcribe/${uploadId}`;
}

export function jobsListEndpoint(): string {
  return `${apiBase}/jobs`;
}

export function jobRerunEndpoint(uploadId: string): string {
  return `${apiBase}/jobs/transcribe/${uploadId}/rerun`;
}

export function chatModelsEndpoint(): string {
  return `${apiBase}/models/chat`;
}

export function transcriptionModelsEndpoint(): string {
  return `${apiBase}/models/transcription`;
}

export function conversationsEndpoint(): string {
  return `${apiBase}/conversations`;
}

export function conversationEndpoint(conversationId: string): string {
  return `${apiBase}/conversations/${conversationId}`;
}

export function conversationMessagesEndpoint(conversationId: string): string {
  return `${apiBase}/conversations/${conversationId}/messages`;
}

export function uploadImageEndpoint(): string {
  return `${apiBase}/upload/image`;
}

export function uploadAudioEndpoint(): string {
  return `${apiBase}/upload/audio`;
}

export function uploadYoutubeEndpoint(): string {
  return `${apiBase}/upload/youtube`;
}

/** WebSocket URL for job notifications (forward WS_PORT in dev containers). */
function wsUrl(): string {
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
