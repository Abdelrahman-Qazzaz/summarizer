export class RateLimitStoreUnavailableError extends Error {
  constructor(cause: unknown) {
    super("Rate limit store unavailable");
    this.name = "RateLimitStoreUnavailableError";
    this.cause = cause;
  }
}
