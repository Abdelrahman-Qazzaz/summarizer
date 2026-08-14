import type { Channel, ConsumeMessage } from "amqplib";
import { logger } from "../logger";
import type { Queue, QueuePayloads } from "./messageQueue.contract";

const log = logger.child({ component: "message-queue" });

async function onMessage<Q extends Queue>(
  message: ConsumeMessage | null,
  handler: (payload: QueuePayloads[Q]) => Promise<void> | void,
  channel: Channel,
  queue: Q,
) {
  if (!message) return;

  try {
    const payload = JSON.parse(message.content.toString()) as QueuePayloads[Q];

    await handler(payload);
    channel.ack(message);
  } catch (error) {
    log.error("Failed to process message", error, { queue });
    channel.nack(message, false, false);
  }
}

export function createConsumer(channel: Channel) {
  return async function consume<Q extends Queue>(
    queue: Q,
    handler: (payload: QueuePayloads[Q]) => Promise<void> | void,
  ): Promise<() => Promise<void>> {
    const { consumerTag } = await channel.consume(queue, (message) =>
      onMessage(message, handler, channel, queue),
    );

    return async function cancelConsumer(): Promise<void> {
      await channel.cancel(consumerTag);
    };
  };
}
