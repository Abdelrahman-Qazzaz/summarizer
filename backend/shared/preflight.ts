export type ServiceCheck = {
  /** Human-readable service name, shown in the startup error. */
  name: string;
  /** Lightweight call that rejects if the service is unavailable. */
  check: () => Promise<unknown>;
};

/**
 * Runs every health check and aborts startup if any third-party service is
 * unavailable. Checks run concurrently so a single boot reports *all* failing
 * services at once rather than one at a time.
 */
export async function verifyServices(checks: ServiceCheck[]): Promise<void> {
  const results = await Promise.allSettled(checks.map((c) => c.check()));

  const failures = results.flatMap((result, i) =>
    result.status === "rejected"
      ? [{ name: checks[i].name, reason: result.reason }]
      : [],
  );

  if (failures.length > 0) {
    const detail = failures
      .map(({ name, reason }) => {
        const message = reason instanceof Error ? reason.message : String(reason);
        return `  - ${name}: ${message}`;
      })
      .join("\n");
    throw new Error(
      `Startup aborted — the following services are unavailable:\n${detail}`,
    );
  }
}
