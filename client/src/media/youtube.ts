// Mirrors the server's YOUTUBE_HOSTS (backend/api/src/schema/upload.schema.ts)
// so the composer can offer a transcript the moment a link is typed — the
// server remains the authority on what it will actually accept.
const YOUTUBE_HOSTS = new Set([
  "youtube.com",
  "www.youtube.com",
  "m.youtube.com",
  "music.youtube.com",
  "youtu.be",
]);

export function isYoutubeUrl(raw: string): boolean {
  try {
    return YOUTUBE_HOSTS.has(new URL(raw).hostname);
  } catch {
    return false;
  }
}

/** The last YouTube link in what the user has typed, or null. */
export function findYoutubeUrl(text: string): string | null {
  const candidates = text.match(/https?:\/\/[^\s<>"']+/gi);
  if (!candidates) return null;

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    // Trailing punctuation is far more likely sentence than URL.
    const candidate = candidates[index].replace(/[.,;:!?)\]]+$/, "");
    if (isYoutubeUrl(candidate)) return candidate;
  }
  return null;
}

/** The video id, for a label short enough to sit in one line of chrome. */
export function youtubeLabel(url: string): string {
  try {
    const parsed = new URL(url);
    const id =
      parsed.hostname === "youtu.be"
        ? parsed.pathname.slice(1)
        : (parsed.searchParams.get("v") ?? parsed.pathname.split("/").pop());
    return id ? `youtube/${id}` : url;
  } catch {
    return url;
  }
}
