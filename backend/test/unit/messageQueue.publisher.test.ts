import type { ConfirmChannel } from "amqplib";
import { describe, expect, it, vi } from "vitest";
import { createPublisher } from "../../shared/message-queue/messageQueue.publisher";

type PublishConfirmation = (error: Error | null) => void;

describe("createPublisher", () => {
  it("settles each concurrent publish from its own confirmation", async () => {
    const confirmations: PublishConfirmation[] = [];
    const channel = {
      publish: vi.fn(
        (
          _exchange,
          _queue,
          _content,
          _options,
          confirmation: PublishConfirmation,
        ) => {
          confirmations.push(confirmation);
          return true;
        },
      ),
    } as unknown as ConfirmChannel;
    const publish = createPublisher(channel, "main");

    const firstPublish = publish("transcribe", {
      audioUploadId: "550e8400-e29b-41d4-a716-446655440000",
    });
    const secondPublish = publish("transcribe", {
      audioUploadId: "c56a4180-65aa-42ec-a945-5fd21dec0538",
    });
    const firstPublishResult = expect(firstPublish).rejects.toThrow(
      "first publish rejected",
    );

    confirmations[1](null);
    await expect(secondPublish).resolves.toBeUndefined();

    confirmations[0](new Error("first publish rejected"));
    await firstPublishResult;
  });
});
