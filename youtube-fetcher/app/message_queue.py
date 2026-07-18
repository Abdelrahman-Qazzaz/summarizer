from __future__ import annotations

import json
import logging
import threading
from typing import Any, Callable

import pika
from env import env
from contract import QueueName

log = logging.getLogger(__name__)

class MQ:
    def __init__(self) -> None:
        self.connection: pika.BlockingConnection | None = None
        self.channel: pika.adapters.blocking_connection.BlockingChannel | None = None

    def connect(self) -> None:
        """Open the AMQP connection. Called by the startup preflight
        (startup.py) — nothing runs at import time."""
        if self.connection is not None:
            return

        params = pika.URLParameters(env.get("MQ_URL"))

        self.connection = pika.BlockingConnection(params)
        self.channel = self.connection.channel()

        # Same as channel.prefetch(1)
        self.channel.basic_qos(prefetch_count=1)

    def close(self) -> None:
        if self.connection is not None and self.connection.is_open:
            self.connection.close()

    def _publish(self, queue: QueueName, data: Any) -> None:
        assert self.channel is not None

        # amqplib's assertQueue defaults to durable — must match or RabbitMQ
        # rejects the redeclaration with PRECONDITION_FAILED.
        self.channel.queue_declare(queue=queue, durable=True)

        self.channel.basic_publish(
            exchange="",
            routing_key=queue,
            body=json.dumps(data).encode(),
        )

    def publish_threadsafe(self, queue: QueueName, data: Any) -> None:
        """Publish from a handler (worker) thread: the connection is
        single-threaded, so hop onto its thread via add_callback_threadsafe."""
        assert self.connection is not None

        self.connection.add_callback_threadsafe(
            lambda: self._publish(queue, data)
        )

    def listen(
        self,
        queue: QueueName,
        handler: Callable[[dict[str, Any]], None],
    ) -> None:
        assert self.connection is not None and self.channel is not None
        connection, channel = self.connection, self.channel

        channel.queue_declare(queue=queue, durable=True)

        # The connection is single-threaded: the worker may only reach it
        # through add_callback_threadsafe.
        def work(delivery_tag: int, body: bytes) -> None:
            try:
                data = json.loads(body.decode())

                handler(data)

                connection.add_callback_threadsafe(
                    lambda: channel.basic_ack(delivery_tag)
                )

            except Exception:
                log.exception("Failed to process message")

                # Drop the message (same as nack(false, false))
                connection.add_callback_threadsafe(
                    lambda: channel.basic_nack(delivery_tag, requeue=False)
                )

        def callback(
            ch: pika.adapters.blocking_connection.BlockingChannel,
            method: pika.spec.Basic.Deliver,
            properties: pika.BasicProperties,
            body: bytes,
        ) -> None:
            # Handlers run off-thread so this loop keeps pumping AMQP
            # heartbeats — a long download here would get the connection
            # dropped. prefetch(1) still caps it to one job at a time.
            threading.Thread(
                target=work, args=(method.delivery_tag, body), daemon=True
            ).start()

        self.channel.basic_consume(
            queue=queue,
            on_message_callback=callback,
        )

        log.info("Listening on %s", queue)
        self.channel.start_consuming()


mq = MQ()

