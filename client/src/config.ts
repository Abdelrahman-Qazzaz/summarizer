/** API origin without trailing slash. Empty = same origin (use Vite proxy in dev). */
export const apiBase = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");

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
