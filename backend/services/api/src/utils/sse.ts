import type { SSEStreamingApi } from "hono/streaming";

/**
 * Emits a named SSE event with a JSON payload. Returns writeSSE's promise so
 * callers can await it for ordering/backpressure.
 */
export function sendEvent(
  stream: SSEStreamingApi,
  event: string,
  payload: unknown,
) {
  return stream.writeSSE({ event, data: JSON.stringify(payload) });
}
