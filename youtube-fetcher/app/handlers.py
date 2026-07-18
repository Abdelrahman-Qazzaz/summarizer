"""Event handlers: download the YouTube audio and upload it to the bucket so
the job flows on exactly like a normal audio upload."""
import logging
import tempfile
from pathlib import Path
import bucket
from contract import contract
import yt_dlp
from message_queue import mq


log = logging.getLogger(__name__)

# The transcribe worker derives the audio format from the stored content type
# (backend/shared/ai/transcribe.ts) — it must be accurate, not just plausible.
EXT_CONTENT_TYPES = {
    "webm": "audio/webm",
    "m4a": "audio/mp4",
    "mp4": "audio/mp4",
    "mp3": "audio/mpeg",
    "opus": "audio/ogg",
    "ogg": "audio/ogg",
    "wav": "audio/wav",
    "flac": "audio/flac",
}


def handle_yt_fetch(event: dict) -> None:
    try:
        upload_id: str = event["uploadId"]
        url: str = event["url"]
        _fetch_and_upload(upload_id, url)
    except Exception as error:
        # Tell the API so it can mark the job row failed — a malformed
        # payload (missing url/userId) must still fail the job if we know
        # which one it is. Re-raise so the dispatcher drops the message.
        if isinstance(event, dict) and event.get("uploadId"):
            mq.publish_threadsafe(
                contract.queues.YT_FETCH_FAILED,
                {
                    "uploadId": event["uploadId"],
                    "userId": event.get("userId", ""),
                    "error": str(error)[:500],
                },
            )
        raise

    mq.publish_threadsafe(contract.queues.TRANSCRIBE, upload_id)
    log.info("Fetched %s, queued transcribe", upload_id)


def _fetch_and_upload(upload_id: str, url: str) -> None:
    max_bytes = contract.maxAudioBytes

    with tempfile.TemporaryDirectory() as tmp:
        options = {
            "format": "bestaudio/best",
            "outtmpl": f"{tmp}/audio.%(ext)s",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            # Same cap the API enforces on direct uploads (from /contract).
            # yt-dlp aborts the download when the limit is known up front.
            "max_filesize": max_bytes,
            # A stalled connection shouldn't hold the (prefetch-1) worker
            # hostage; yt-dlp retries after a timeout.
            "socket_timeout": 30,
        }
        with yt_dlp.YoutubeDL(options) as ydl:
            # Probe metadata first so oversized audio is rejected before any
            # bytes are downloaded.
            info = ydl.extract_info(url, download=False)
            if info and isinstance(info,dict):
                formats = info.get("requested_formats") or [info]
                expected = sum(
                    f.get("filesize") or f.get("filesize_approx") or 0
                    for f in formats
                )
                if expected > max_bytes:
                    raise RuntimeError(
                        f"audio is ~{expected} bytes,"
                        f" over the {max_bytes}-byte limit"
                    )

            ydl.download([url])

        files = [p for p in Path(tmp).iterdir() if p.is_file()]

        if not files:
            raise RuntimeError(
                "yt-dlp produced no output file"
                f" (audio may exceed the {max_bytes // (1024 * 1024)}MB limit"
                " or the video may be unavailable)"
            )

        audio = files[0]
        size = audio.stat().st_size
        # Backstop: filesize/filesize_approx can be missing or undershoot, and
        # max_filesize can't abort formats whose size isn't known up front.
        if size > max_bytes:
            raise RuntimeError(
                f"audio is {size} bytes, over the {max_bytes}-byte limit"
            )
        content_type = EXT_CONTENT_TYPES.get(
            audio.suffix.removeprefix(".").lower(), "audio/mpeg"
        )
        log.info("Downloaded %s: %d bytes, %s", upload_id, size, content_type)
        # Stored at the bare uploadId — same path convention as direct uploads
        # (backend/shared/bucket.ts), so the transcribe worker finds it.
        bucket.upload_file(str(audio), upload_id, content_type)
