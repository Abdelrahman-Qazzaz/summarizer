import httpx
from env import env
from dataclasses import dataclass
from typing import  NewType


QueueName = NewType("QueueName", str)


@dataclass
class _Queues:
    YT_FETCH: QueueName
    YT_FETCH_FAILED: QueueName
    TRANSCRIBE: QueueName

class _Contract:
    queues: _Queues
    bucket: str
    maxAudioBytes: int

    def load(self) -> None:
        """Fetch the cross-service contract from the API. Called by the
        startup preflight (startup.py) — nothing runs at import time."""
        api_base_url = env.get("API_BASE_URL")
        response = httpx.get(f"{api_base_url.rstrip('/')}/contract", timeout=5)
        response.raise_for_status()
        body = response.json()
        # /contract serves every backend queue; pick only the ones we use.
        queues = body["queues"]
        self.queues = _Queues(
            YT_FETCH=QueueName(queues["YT_FETCH"]),
            YT_FETCH_FAILED=QueueName(queues["YT_FETCH_FAILED"]),
            TRANSCRIBE=QueueName(queues["TRANSCRIBE"]),
        )
        self.bucket = body["bucket"]
        self.maxAudioBytes = body["maxAudioBytes"]

contract = _Contract()
