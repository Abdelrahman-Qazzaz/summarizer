import logging

from env import env
from supabase import create_client,Client
from contract import contract


log = logging.getLogger(__name__)

SUPABASE_URL = env.get("SUPABASE_URL")
SUPABASE_KEY = env.get("SUPABASE_SERVICE_ROLE_KEY")

supabase: Client = create_client(SUPABASE_URL, SUPABASE_KEY)


def ping_bucket() -> None:
    """Startup health check: raises if Supabase is unreachable or the bucket
    is missing. The bucket name comes from the contract, so contract.load()
    must have run first (startup.py orders the checks that way)."""
    bucket = supabase.storage.get_bucket(contract.bucket)
    log.info("Bucket OK: %s (public=%s)", bucket.name, bucket.public)


def upload_file(local_path: str, remote_path: str, content_type: str):
    """Upload a local file to the bucket."""
    with open(local_path, "rb") as f:
        res = supabase.storage.from_(contract.bucket).upload(
            path=remote_path,                     # e.g. the bare uploadId
            file=f,
            file_options={
                "content-type": content_type,
                "upsert": "true",                 # overwrite if it already exists
            },
        )
    log.info("Uploaded: %s", res.path)
    return res
