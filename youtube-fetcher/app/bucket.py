import logging

from contract import contract
from env import env
from supabase import Client, create_client

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


def _object_path(user_id: str, kind: str, storage_object_id: str) -> str:
    """Storage key "<userId>/<kind>/<storageObjectId>". Mirrors objectPath in
    backend/shared/bucket.ts so both services agree on the layout, and owner
    and kind both stay structural. Keep them in sync."""
    return f"{user_id}/{kind}/{storage_object_id}"


def upload_audio(
    user_id: str, audio_upload_id: str, local_path: str, content_type: str
):
    """Store downloaded audio where the transcribe worker signs it from."""
    return _upload_file(user_id, "audios", audio_upload_id, local_path, content_type)


def upload_caption(
    user_id: str, caption_upload_id: str, local_path: str, content_type: str
):
    """Store a caption track where the transcribe worker reads it from."""
    return _upload_file(
        user_id, "captions", caption_upload_id, local_path, content_type
    )


def _upload_file(
    user_id: str,
    kind: str,
    storage_object_id: str,
    local_path: str,
    content_type: str,
):
    """Upload a local file to the bucket. The caller names the owner, kind
    and id; the path is built here rather than by the caller."""
    with open(local_path, "rb") as f:
        res = supabase.storage.from_(contract.bucket).upload(
            path=_object_path(user_id, kind, storage_object_id),
            file=f,
            file_options={
                "content-type": content_type,
                "upsert": "true",  # overwrite if it already exists
            },
        )
    log.info("Uploaded: %s", res.path)
    return res
