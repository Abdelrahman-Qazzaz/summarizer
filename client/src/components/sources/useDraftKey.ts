import { useMatch } from "react-router-dom";

/**
 * Which draft a source would be attached to. The sources surfaces render
 * outside the chat route, so they read the conversation off the path rather
 * than from route params.
 */
export function useDraftKey(): string {
  const chatMatch = useMatch("/chat/:conversationId");
  return chatMatch?.params.conversationId ?? "new";
}
