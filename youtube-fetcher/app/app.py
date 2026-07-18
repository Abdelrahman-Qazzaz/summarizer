"""Entrypoint: run the preflight, then consume yt_fetch until SIGTERM."""

import logging
import signal

from contract import contract
from handlers import handle_yt_fetch
from message_queue import mq
from startup import verify_fetcher_services

log = logging.getLogger(__name__)


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )

    verify_fetcher_services()

    # Raise in the main thread so start_consuming unwinds; calling
    # stop_consuming from inside the connection's own I/O loop hangs.
    def stop(signum: int, frame: object) -> None:
        raise KeyboardInterrupt

    signal.signal(signal.SIGTERM, stop)

    try:
        mq.listen(contract.queues.YT_FETCH, handle_yt_fetch)
    except KeyboardInterrupt:
        log.info("Shutting down")
    finally:
        mq.close()


if __name__ == "__main__":
    main()
