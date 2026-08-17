/**
 * Every call the client makes goes out through here: session cookies attached,
 * failures raised as one error type carrying the status the caller may branch on
 * (409 conflicts, 413 over-budget transcripts, 404 missing sources).
 */
export class ApiError extends Error {
  readonly status: number;
  readonly data: unknown;

  constructor(message: string, status: number, data: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.data = data;
  }
}

async function readBody(response: Response): Promise<unknown> {
  return response.json().catch(() => null);
}

/** The API reports failures as `{ message }`; fall back to the status line. */
function failureMessage(data: unknown, response: Response): string {
  if (
    data &&
    typeof data === "object" &&
    "message" in data &&
    typeof (data as { message: unknown }).message === "string"
  ) {
    return (data as { message: string }).message;
  }
  return response.statusText || `Request failed (${response.status})`;
}

export function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * Returns the raw response so streaming callers (the SSE reply) can read the
 * body themselves; throws before that on any non-2xx.
 */
export async function apiFetch(
  url: string,
  init: RequestInit = {},
): Promise<Response> {
  const response = await fetch(url, { credentials: "include", ...init });
  if (!response.ok) {
    const data = await readBody(response);
    throw new ApiError(failureMessage(data, response), response.status, data);
  }
  return response;
}

export async function apiJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await apiFetch(url, init);
  return (await response.json()) as T;
}

export function jsonRequest(method: string, body: unknown): RequestInit {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}
