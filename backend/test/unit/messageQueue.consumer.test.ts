import type { Channel, ConsumeMessage } from "amqplib";
import { describe, expect, it, vi } from "vitest";
import { createConsumer } from "../../shared/message-queue/messageQueue.consumer";
import { QUEUES } from "../../shared/message-queue/messageQueue";

describe("message queue consumer", () => {
  it("passes RabbitMQ redelivery metadata to the handler", async () => {
    let deliveryCallback:
      ((message: ConsumeMessage | null) => unknown) | undefined;
    const acknowledge = vi.fn();
    const channel = {
      consume: vi.fn(
        async (
          _queue: string,
          callback: (message: ConsumeMessage | null) => unknown,
        ) => {
          deliveryCallback = callback;
          return { consumerTag: "consumer-1" };
        },
      ),
      ack: acknowledge,
      nack: vi.fn(),
      cancel: vi.fn(),
    } as unknown as Channel;
    const handler = vi.fn().mockResolvedValue(undefined);

    await createConsumer(channel)(QUEUES.TRANSCRIBE, handler);

    const message = {
      content: Buffer.from(
        JSON.stringify({
          audioUploadId: "550e8400-e29b-41d4-a716-446655440000",
        }),
      ),
      fields: { redelivered: true },
    } as unknown as ConsumeMessage;
    await deliveryCallback?.(message);

    expect(handler).toHaveBeenCalledWith(
      { audioUploadId: "550e8400-e29b-41d4-a716-446655440000" },
      { redelivered: true },
    );
    expect(acknowledge).toHaveBeenCalledWith(message);
  });
});
