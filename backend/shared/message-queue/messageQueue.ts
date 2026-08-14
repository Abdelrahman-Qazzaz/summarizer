import amqplib from "amqplib";
import type { ChannelModel } from "amqplib";
import { getBaseEnv } from "../env";
import { createPublisher } from "./messageQueue.publisher";
import { QUEUES } from "./messageQueue.contract";
import type { Queue, QueuePayloads } from "./messageQueue.contract";
import { setupTopology } from "./messageQueue.topology";
import { createConsumer } from "./messageQueue.consumer";

export type { UploadId } from "./messageQueue.contract";

const EXCHANGES = {
  MAIN: "main",
  RETRY: "retry",
  DLX: "dead_letter",
} as const;

export async function createMessageQueue(url: string) {
  const connection: ChannelModel = await amqplib.connect(url);

  const publisherChannel = await connection.createConfirmChannel();
  await setupTopology(publisherChannel, {
    exchanges: Object.values(EXCHANGES),
    queues: Object.values(QUEUES),
    mainExchange: EXCHANGES.MAIN,
  });

  const consumerChannel = await connection.createChannel();
  await consumerChannel.prefetch(1);

  return {
    queues: QUEUES,
    publish: createPublisher(publisherChannel, EXCHANGES.MAIN),
    consume: createConsumer(consumerChannel),
    close: () => connection.close(),
  };
}

// TODO: this is a compatability adapter, discard and change callers of this module instead.
type MessageQueue = Awaited<ReturnType<typeof createMessageQueue>>;

let messageQueuePromise: Promise<MessageQueue> | undefined;

function getMessageQueue(): Promise<MessageQueue> {
  messageQueuePromise ??= createMessageQueue(getBaseEnv().MQ_URL).catch(
    (error) => {
      messageQueuePromise = undefined;
      throw error;
    },
  );

  return messageQueuePromise;
}

export async function pingMQ(): Promise<void> {
  await getMessageQueue();
}

export const mq = {
  queues: QUEUES,
  async publish<Q extends Queue>(queue: Q, payload: QueuePayloads[Q]) {
    const messageQueue = await getMessageQueue();
    await messageQueue.publish(queue, payload);
  },
  async consume<Q extends Queue>(
    queue: Q,
    handler: (payload: QueuePayloads[Q]) => Promise<void> | void,
  ) {
    const messageQueue = await getMessageQueue();
    return messageQueue.consume(queue, handler);
  },
  async close(): Promise<void> {
    const currentMessageQueue = messageQueuePromise;
    messageQueuePromise = undefined;

    if (!currentMessageQueue) return;
    await (await currentMessageQueue).close();
  },
};
