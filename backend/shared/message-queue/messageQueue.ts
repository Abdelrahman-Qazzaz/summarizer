import amqplib from "amqplib";
import type { ChannelModel } from "amqplib";
import { createPublisher } from "./messageQueue.publisher";
import { QUEUES } from "./messageQueue.contract";
import type { Queue, QueuePayloads } from "./messageQueue.contract";
import { setupTopology } from "./messageQueue.topology";
import { createConsumer } from "./messageQueue.consumer";
import { getBaseEnv } from "../env";
export { QUEUES } from "./messageQueue.contract";

const EXCHANGES = {
  MAIN: "main",
  RETRY: "retry",
  DLX: "dead_letter",
} as const;

export async function pingMQ() {
  const messageQueue = await createMessageQueue(getBaseEnv().MQ_URL);
  await messageQueue.close();
}
async function createMessageQueue(url: string) {
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

let messageQueuePromise: ReturnType<typeof createMessageQueue> | undefined;

function getMessageQueue() {
  messageQueuePromise ??= createMessageQueue(getBaseEnv().MQ_URL);
  return messageQueuePromise;
}

export const mq = {
  queues: QUEUES,
  async publish<Q extends Queue>(queue: Q, payload: QueuePayloads[Q]) {
    await (await getMessageQueue()).publish(queue, payload);
  },
  async consume<Q extends Queue>(
    queue: Q,
    handler: (payload: QueuePayloads[Q]) => Promise<void> | void,
  ) {
    return (await getMessageQueue()).consume(queue, handler);
  },
  async close() {
    if (!messageQueuePromise) return;

    const messageQueue = await messageQueuePromise;
    messageQueuePromise = undefined;
    await messageQueue.close();
  },
};
