import json
from unittest.mock import MagicMock

import message_queue
from message_queue import MQ


def make_mq():
    mq = MQ()
    mq.connection = MagicMock()
    mq.channel = MagicMock()
    mq.connection.is_open = True
    # Run thread-hops inline so the tests stay synchronous.
    mq.connection.add_callback_threadsafe.side_effect = lambda cb: cb()
    return mq


class SyncThread:
    """Replaces the handler worker thread so deliveries run inline."""

    def __init__(self, target=None, args=(), daemon=None):
        self._target, self._args = target, args

    def start(self):
        self._target(*self._args)


def deliver(mq, monkeypatch, body, handler):
    """Wire up a consumer and push one message through it."""
    monkeypatch.setattr(message_queue.threading, "Thread", SyncThread)
    mq.listen("q", handler)

    callback = mq.channel.basic_consume.call_args.kwargs["on_message_callback"]
    method = MagicMock()
    method.delivery_tag = 7
    callback(mq.channel, method, MagicMock(), body)


def test_publish_declares_durable_queue_and_sends_json():
    mq = make_mq()

    mq._publish("q", {"a": 1})

    # amqplib's assertQueue on the TS side defaults to durable — the
    # declaration must match or RabbitMQ rejects it.
    mq.channel.queue_declare.assert_called_once_with(queue="q", durable=True)
    kwargs = mq.channel.basic_publish.call_args.kwargs
    assert kwargs["exchange"] == ""
    assert kwargs["routing_key"] == "q"
    assert json.loads(kwargs["body"]) == {"a": 1}


def test_publish_threadsafe_hops_to_the_connection_thread():
    mq = make_mq()

    mq.publish_threadsafe("q", "payload")

    mq.connection.add_callback_threadsafe.assert_called_once()
    body = mq.channel.basic_publish.call_args.kwargs["body"]
    assert json.loads(body) == "payload"


def test_close_only_closes_an_open_connection():
    mq = make_mq()
    mq.connection.is_open = False
    mq.close()
    mq.connection.close.assert_not_called()

    mq.connection.is_open = True
    mq.close()
    mq.connection.close.assert_called_once()

    MQ().close()  # never connected: no-op, must not raise


def test_listen_acks_after_successful_handling(monkeypatch):
    mq = make_mq()
    seen = []

    deliver(mq, monkeypatch, b'{"uploadId": "u1"}', seen.append)

    assert seen == [{"uploadId": "u1"}]
    mq.channel.basic_ack.assert_called_once_with(7)
    mq.channel.basic_nack.assert_not_called()


def test_listen_drops_message_when_handler_fails(monkeypatch):
    mq = make_mq()

    def handler(data):
        raise RuntimeError("boom")

    deliver(mq, monkeypatch, b"{}", handler)

    mq.channel.basic_nack.assert_called_once_with(7, requeue=False)
    mq.channel.basic_ack.assert_not_called()


def test_listen_drops_undecodable_message(monkeypatch):
    mq = make_mq()
    seen = []

    deliver(mq, monkeypatch, b"not json", seen.append)

    assert seen == []
    mq.channel.basic_nack.assert_called_once_with(7, requeue=False)
    mq.channel.basic_ack.assert_not_called()
