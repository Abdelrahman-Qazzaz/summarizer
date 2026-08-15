import type { ConfirmChannel } from "amqplib";
import type { Queue, QueuePayloads } from "./messageQueue.contract";

export function createPublisher(channel: ConfirmChannel, exchange: string) {
  return async function publish<Q extends Queue>(
    queue: Q,
    payload: QueuePayloads[Q],
  ): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      channel.publish(
        exchange,
        queue,
        Buffer.from(JSON.stringify(payload)),
        {
          contentType: "application/json",
          persistent: true,
        },
        (error) => {
          if (error) reject(error);
          else resolve();
        },
      );
    });
  };
}
