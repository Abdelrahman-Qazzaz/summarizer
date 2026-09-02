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

export function jobEndpoint(audioUploadId: string): string {
  return `${apiBase}/jobs/transcribe/${audioUploadId}`;
}

export function jobsListEndpoint(): string {
  return `${apiBase}/jobs`;
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

/**
 * Socket.IO lives on the API's own origin — the server attaches it to the same
 * HTTP server, so there is no second URL to configure and the session cookie
 * that authenticates the handshake is already in scope.
 */
export function socketIoUrl(): string {
  return apiBase;
}
