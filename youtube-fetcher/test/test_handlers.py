from pathlib import Path
from unittest.mock import MagicMock

import pytest
import yt_dlp

import handlers
from contract import QueueName, _Queues, contract

MAX_BYTES = 1000


@pytest.fixture(autouse=True)
def fake_contract():
    # The contract singleton is normally populated by the startup preflight.
    contract.queues = _Queues(
        YT_FETCH=QueueName("yt_fetch"),
        YT_FETCH_FAILED=QueueName("yt_fetch_failed"),
        TRANSCRIBE=QueueName("transcribe"),
    )
    contract.bucket = "uploads"
    contract.maxAudioBytes = MAX_BYTES


@pytest.fixture
def publish(monkeypatch):
    mock = MagicMock()
    monkeypatch.setattr(handlers.mq, "publish_threadsafe", mock)
    return mock


@pytest.fixture
def upload(monkeypatch):
    mock = MagicMock()
    monkeypatch.setattr(handlers.bucket, "upload_file", mock)
    return mock


class FakeYDL:
    """Stands in for yt_dlp.YoutubeDL: "downloads" by writing the preset
    files into the outtmpl directory. Tests override the class attributes."""

    info: dict = {"filesize": 10}
    files: dict[str, bytes] = {"audio.webm": b"x" * 10}
    last: "FakeYDL | None" = None

    def __init__(self, options):
        self.options = options
        type(self).last = self

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def extract_info(self, url, download=False):
        return self.info

    def download(self, urls):
        out_dir = Path(self.options["outtmpl"]).parent
        for name, content in self.files.items():
            (out_dir / name).write_bytes(content)


@pytest.fixture
def ydl(monkeypatch):
    class YDL(FakeYDL):
        pass

    monkeypatch.setattr(handlers.yt_dlp, "YoutubeDL", YDL)
    return YDL


class TestFetchAndUpload:
    def test_uploads_audio_with_derived_content_type(self, ydl, upload):
        handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")

        (user_id, upload_id, local_path, content_type), _ = upload.call_args
        assert user_id == "usr"
        assert upload_id == "u1"
        assert local_path.endswith("audio.webm")
        assert content_type == "audio/webm"

    def test_enforces_contract_size_cap_in_ydl_options(self, ydl, upload):
        handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")

        assert ydl.last.options["max_filesize"] == MAX_BYTES
        assert ydl.last.options["noplaylist"] is True

    def test_downloads_in_small_http_chunks(self, ydl, upload):
        handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")

        assert ydl.last.options["http_chunk_size"] == 1024 * 1024

    def test_rejects_oversized_audio_before_downloading(self, ydl, upload):
        ydl.info = {"filesize": MAX_BYTES + 1}
        ydl.files = {}

        with pytest.raises(RuntimeError, match="over the"):
            handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")
        upload.assert_not_called()

    def test_sums_sizes_across_requested_formats(self, ydl, upload):
        ydl.info = {
            "requested_formats": [
                {"filesize": 600},
                {"filesize_approx": 600},
            ]
        }
        ydl.files = {}

        with pytest.raises(RuntimeError, match="over the"):
            handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")
        upload.assert_not_called()

    def test_never_uploads_partial_download_leftovers(self, ydl, upload):
        # A download aborted mid-transfer leaves *.part (and sometimes the
        # *.ytdl resume-state sidecar) behind, with no finished file.
        ydl.info = {}
        ydl.files = {
            "audio.webm.part": b"x" * 5,
            "audio.webm.ytdl": b"{}",
        }

        with pytest.raises(RuntimeError, match="no output file"):
            handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")
        upload.assert_not_called()

    def test_picks_finished_file_over_stale_partials(self, ydl, upload):
        ydl.files = {
            "audio.webm": b"x" * 10,
            "audio.webm.part": b"x" * 5,
        }

        handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")

        (_, _, local_path, content_type), _ = upload.call_args
        assert local_path.endswith("audio.webm")
        assert content_type == "audio/webm"

    def test_size_backstop_when_metadata_had_no_size(self, ydl, upload):
        ydl.info = {}
        ydl.files = {"audio.webm": b"x" * (MAX_BYTES + 1)}

        with pytest.raises(RuntimeError, match="over the"):
            handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")
        upload.assert_not_called()

    def test_unknown_extension_falls_back_to_mpeg(self, ydl, upload):
        ydl.files = {"audio.weird": b"x" * 10}

        handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")

        (_, _, _, content_type), _ = upload.call_args
        assert content_type == "audio/mpeg"


class TestHandleYtFetch:
    def test_success_queues_transcribe(self, publish, monkeypatch):
        monkeypatch.setattr(handlers, "_fetch_and_upload", MagicMock())

        handlers.handle_yt_fetch(
            {"uploadId": "u1", "url": "https://youtu.be/x", "userId": "usr"}
        )

        publish.assert_called_once_with(
            QueueName("transcribe"),
            {"uploadId": "u1"},
        )

    def test_failure_notifies_api_and_reraises(self, publish, monkeypatch):
        monkeypatch.setattr(
            handlers,
            "_fetch_and_upload",
            MagicMock(side_effect=RuntimeError("boom")),
        )

        with pytest.raises(RuntimeError, match="boom"):
            handlers.handle_yt_fetch(
                {"uploadId": "u1", "url": "https://youtu.be/x", "userId": "usr"}
            )

        publish.assert_called_once_with(
            QueueName("yt_fetch_failed"),
            {"uploadId": "u1", "userId": "usr", "error": "boom"},
        )

    def test_failure_error_message_is_truncated(self, publish, monkeypatch):
        monkeypatch.setattr(
            handlers,
            "_fetch_and_upload",
            MagicMock(side_effect=RuntimeError("x" * 600)),
        )

        with pytest.raises(RuntimeError):
            handlers.handle_yt_fetch(
                {"uploadId": "u1", "url": "https://youtu.be/x", "userId": "usr"}
            )

        (_, payload), _ = publish.call_args
        assert len(payload["error"]) == 500

    def test_malformed_payload_with_upload_id_still_fails_the_job(
        self, publish
    ):
        with pytest.raises(KeyError):
            handlers.handle_yt_fetch({"uploadId": "u1"})  # no url

        (queue, payload), _ = publish.call_args
        assert queue == "yt_fetch_failed"
        assert payload["uploadId"] == "u1"
        assert payload["userId"] == ""

    def test_unidentifiable_payload_is_not_reported(self, publish):
        with pytest.raises(KeyError):
            handlers.handle_yt_fetch({})

        publish.assert_not_called()


class TestFetchWithRetries:
    """The CDN rejects a signed media URL with 403 often enough that a single
    attempt is not enough. Each retry must re-run the whole fetch, because the
    rejected URL is the thing that failed."""

    @pytest.fixture(autouse=True)
    def no_sleep(self, monkeypatch):
        monkeypatch.setattr(handlers.time, "sleep", lambda _seconds: None)

    def transient(self):
        return yt_dlp.utils.DownloadError(
            "ERROR: unable to download video data: HTTP Error 403: Forbidden"
        )

    def test_retries_a_transient_failure_until_it_succeeds(self, monkeypatch):
        fetch = MagicMock(side_effect=[self.transient(), self.transient(), None])
        monkeypatch.setattr(handlers, "_fetch_and_upload", fetch)

        handlers._fetch_with_retries("u1", "https://youtu.be/x", "usr")

        assert fetch.call_count == 3

    def test_gives_up_after_the_attempt_limit(self, monkeypatch):
        fetch = MagicMock(side_effect=self.transient())
        monkeypatch.setattr(handlers, "_fetch_and_upload", fetch)

        with pytest.raises(yt_dlp.utils.DownloadError):
            handlers._fetch_with_retries("u1", "https://youtu.be/x", "usr")

        assert fetch.call_count == handlers.FETCH_ATTEMPTS

    def test_does_not_retry_a_permanently_unavailable_video(self, monkeypatch):
        fetch = MagicMock(
            side_effect=yt_dlp.utils.DownloadError("ERROR: Video unavailable")
        )
        monkeypatch.setattr(handlers, "_fetch_and_upload", fetch)

        with pytest.raises(yt_dlp.utils.DownloadError):
            handlers._fetch_with_retries("u1", "https://youtu.be/x", "usr")

        assert fetch.call_count == 1

    def test_does_not_retry_our_own_deterministic_failures(self, monkeypatch):
        # Oversized audio fails identically every time; retrying only delays
        # marking the job failed.
        fetch = MagicMock(side_effect=RuntimeError("audio is 999 bytes, over"))
        monkeypatch.setattr(handlers, "_fetch_and_upload", fetch)

        with pytest.raises(RuntimeError):
            handlers._fetch_with_retries("u1", "https://youtu.be/x", "usr")

        assert fetch.call_count == 1


class TestYoutubeAccess:
    """The options that decide whether YouTube serves us at all. Each of these
    fails the same way when wrong — metadata resolves, then the media download
    returns 403 — so they are asserted rather than left to be rediscovered."""

    def test_names_node_alongside_deno_as_a_js_runtime(self, ydl, upload):
        # The `n` parameter in a media URL is descrambled by running YouTube's
        # player JS; yt-dlp enables only deno by default.
        handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")

        assert set(ydl.last.options["js_runtimes"]) == {"deno", "node"}

    def test_uses_the_one_client_whose_formats_are_downloadable(
        self, ydl, upload
    ):
        # web and web_safari return SABR-only formats with no URL; android_vr
        # is refused even holding a valid proof-of-origin token.
        handlers._fetch_and_upload("u1", "https://youtu.be/x", "usr")

        assert ydl.last.options["extractor_args"] == {
            "youtube": {"player_client": ["web_embedded"]}
        }
