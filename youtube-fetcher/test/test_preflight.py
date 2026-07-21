import pytest

from preflight import verify_services


def _failing(message):
    def check():
        raise ConnectionError(message)

    return check


def test_all_healthy_runs_every_check():
    calls = []
    verify_services(
        [("a", lambda: calls.append("a")), ("b", lambda: calls.append("b"))]
    )
    assert calls == ["a", "b"]


def test_single_failure_aborts_startup():
    with pytest.raises(RuntimeError, match="RabbitMQ"):
        verify_services([("RabbitMQ", _failing("connection refused"))])


def test_one_boot_reports_every_unavailable_service():
    with pytest.raises(RuntimeError) as excinfo:
        verify_services(
            [
                ("RabbitMQ", _failing("connection refused")),
                ("healthy", lambda: None),
                ("Supabase Storage", _failing("bucket missing")),
            ]
        )

    message = str(excinfo.value)
    assert "RabbitMQ" in message
    assert "connection refused" in message
    assert "Supabase Storage" in message
    assert "bucket missing" in message
