"""Event handlers: download the YouTube audio and upload it to the bucket so
the job flows on exactly like a normal audio upload."""
import logging
import tempfile
import time
from pathlib import Path
import bucket
from contract import contract
import yt_dlp
from message_queue import mq


log = logging.getLogger(__name__)

# YouTube's media CDN intermittently rejects a signed download URL with 403,
# and the same URL will keep being rejected — so a retry has to re-extract to
# get fresh ones, which is why the whole fetch is retried rather than the
# request. Handlers run off the AMQP I/O thread (message_queue.listen), so
# sleeping here does not stall heartbeats.
FETCH_ATTEMPTS = 3
RETRY_BACKOFF_SECONDS = 2

# Failures no amount of retrying will fix; retrying them only delays the job
# being marked failed. Matched against the message because yt-dlp raises one
# DownloadError type for everything.
PERMANENT_FAILURES = (
    "video unavailable",
    "private video",
    "removed by the uploader",
    "members-only",
    "sign in to confirm your age",
    "no video formats found",
    "unsupported url",
    "is not a valid url",
)

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


def _is_retryable(error: Exception) -> bool:
    """Only yt-dlp download failures are worth another extraction. Our own
    RuntimeErrors (oversized audio, no output file) are deterministic."""
    if not isinstance(error, yt_dlp.utils.DownloadError):
        return False
    message = str(error).lower()
    return not any(marker in message for marker in PERMANENT_FAILURES)


def _fetch_with_retries(upload_id: str, url: str, user_id: str) -> None:
    for attempt in range(1, FETCH_ATTEMPTS + 1):
        try:
            _fetch_and_upload(upload_id, url, user_id)
            return
        except Exception as error:
            if attempt == FETCH_ATTEMPTS or not _is_retryable(error):
                raise
            backoff = RETRY_BACKOFF_SECONDS * attempt
            log.warning(
                "Fetch %s attempt %d/%d failed (%s); re-extracting in %ds",
                upload_id,
                attempt,
                FETCH_ATTEMPTS,
                str(error)[:200],
                backoff,
            )
            time.sleep(backoff)


def handle_yt_fetch(event: dict) -> None:
    try:
        upload_id: str = event["uploadId"]
        url: str = event["url"]
        user_id: str = event["userId"]
        _fetch_with_retries(upload_id, url, user_id)
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

    mq.publish_threadsafe(
        contract.queues.TRANSCRIBE,
        {"uploadId": upload_id},
    )
    log.info("Fetched %s, queued transcribe", upload_id)


def _fetch_and_upload(upload_id: str, url: str, user_id: str) -> None:
    max_bytes = contract.maxAudioBytes

    with tempfile.TemporaryDirectory() as tmp:
        options = {
            # Lowest-bitrate audio-only stream: STT downsamples to 16kHz mono,
            # so anything above ~48kbps is discarded work — and transcribe.ts
            # base64s the whole file into one JSON body, where the bytes hurt.
            "format": "worstaudio/bestaudio/best",
            "outtmpl": f"{tmp}/audio.%(ext)s",
            "noplaylist": True,
            "quiet": True,
            "no_warnings": True,
            # Same cap the API enforces on direct uploads (from /contract).
            # yt-dlp aborts the download when the limit is known up front.
            "max_filesize": max_bytes,
            # YouTube's media CDN can reject non-ranged downloads with 403.
            "http_chunk_size": 1024 * 1024,
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

        # An aborted download (e.g. max_filesize hit mid-transfer) leaves a
        # truncated *.part file behind — never upload those.
        files = [
            p
            for p in Path(tmp).iterdir()
            if p.is_file() and not p.name.endswith((".part", ".ytdl"))
        ]

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
        # upload_file builds the user-scoped "<userId>/<uploadId>" key (same
        # convention as direct uploads, backend/shared/bucket.ts objectPath),
        # so the transcribe worker finds it and ownership stays structural.
        bucket.upload_file(user_id, upload_id, str(audio), content_type)
