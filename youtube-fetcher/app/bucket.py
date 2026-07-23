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


def _object_path(user_id: str, upload_id: str) -> str:
    """Storage key scoped under the owning user: "<userId>/<uploadId>".
    Mirrors objectPath in backend/shared/bucket.ts so both services agree on
    the layout and bucket ownership stays structural. Keep them in sync."""
    return f"{user_id}/{upload_id}"


def upload_file(
    user_id: str, upload_id: str, local_path: str, content_type: str
):
    """Upload a local file to the bucket at the user-scoped key.
    Signature mirrors uploadAudioToBucket/uploadTextToBucket in
    backend/shared/bucket.ts: the caller passes the owner and id, and the
    path is built here rather than by the caller."""
    with open(local_path, "rb") as f:
        res = supabase.storage.from_(contract.bucket).upload(
            path=_object_path(user_id, upload_id),
            file=f,
            file_options={
                "content-type": content_type,
                "upsert": "true",                 # overwrite if it already exists
            },
        )
    log.info("Uploaded: %s", res.path)
    return res
