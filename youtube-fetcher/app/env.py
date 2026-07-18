import os
from typing import Literal

EnvKey = Literal[
    "MQ_URL",
    "SUPABASE_URL",
    "SUPABASE_SERVICE_ROLE_KEY",
    "API_BASE_URL",
]

class _Env:
    REQUIRED_VARS: tuple[EnvKey, ...] = (
        "MQ_URL",
        "SUPABASE_URL",
        "SUPABASE_SERVICE_ROLE_KEY",
        "API_BASE_URL",
    )

    def __init__(self):
        for var in self.REQUIRED_VARS:
            setattr(self, var, os.getenv(var))

        self.verify()

    def verify(self):
        missing = [
            var for var in self.REQUIRED_VARS
            if getattr(self, var) is None
        ]

        if missing:
            raise RuntimeError(
                f"Missing environment variables: {', '.join(missing)}"
            )

    def get(self, key: EnvKey) -> str:
        return getattr(self, key)


env = _Env()
