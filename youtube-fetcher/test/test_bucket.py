from unittest.mock import MagicMock

import bucket
import pytest


@pytest.fixture
def upload_file(monkeypatch):
    mock = MagicMock()
    monkeypatch.setattr(bucket, "_upload_file", mock)
    return mock


def test_object_path_matches_the_backend_layout():
    # backend/shared/bucket.ts objectPath builds the same key; the transcribe
    # worker reads youtube audio and captions back from exactly here.
    assert bucket._object_path("usr", "audios", "a1") == "usr/audios/a1"


def test_audio_is_stored_under_audios(upload_file):
    bucket.upload_audio("usr", "a1", "/tmp/audio.webm", "audio/webm")

    upload_file.assert_called_once_with(
        "usr", "audios", "a1", "/tmp/audio.webm", "audio/webm"
    )


def test_captions_are_stored_under_captions(upload_file):
    bucket.upload_caption("usr", "c1", "/tmp/captions.txt", "text/plain")

    upload_file.assert_called_once_with(
        "usr", "captions", "c1", "/tmp/captions.txt", "text/plain"
    )
