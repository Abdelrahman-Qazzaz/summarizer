"""Fail-fast preflight, mirroring backend/shared/preflight.ts: run every
health check and abort startup if any dependency is unavailable. Unlike the
backend's concurrent Promise.allSettled, checks run sequentially — but every
failure is still collected so one boot reports all unavailable services."""

import logging
from typing import Callable

log = logging.getLogger(__name__)

# (human-readable name, lightweight call that raises if unavailable)
ServiceCheck = tuple[str, Callable[[], object]]


def verify_services(checks: list[ServiceCheck]) -> None:
    failures: list[tuple[str, Exception]] = []

    for name, check in checks:
        try:
            check()
        except Exception as error:
            log.error("Service unavailable at startup: %s: %s", name, error)
            failures.append((name, error))

    if failures:
        detail = "\n".join(f"  - {name}: {error}" for name, error in failures)
        raise RuntimeError(
            f"Startup aborted — the following services are unavailable:\n{detail}"
        )
