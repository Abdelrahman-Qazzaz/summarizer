import amqplib from "amqplib";
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import { getBaseEnv } from "../env";
import { logger } from "../logger";
import type { MQQueues, QueuePayloads } from "../types/mq.types";

class MQ {
  /**
   * Queue names — the single source of truth for the cross-service contract.
   * The API serves these at `GET /contract` so the Python youtube-fetcher can
   * read them at boot instead of hand-mirroring constants. See
   * `youtube-fetcher/app/queues.py`.
   */
  queues = {
    TRANSCRIBE: "transcribe",
    SUMMARIZE: "summarize",
    SUMMARIZE_CHUNK: "summarize_chunk",
    TRANSCRIBE_DONE: "transcribe_done",
    SUMMARIZE_DONE: "summarize_done",
    // Cross-language boundary with youtube-fetcher (Python).
    YT_FETCH: "yt_fetch",
    YT_FETCH_FAILED: "yt_fetch_failed",
    // `satisfies` ties every queue to a payload in QueuePayloads: add a queue
    // here without a payload there and this fails to compile.
  } as const satisfies Record<string, MQQueues>;
  private conn!: ChannelModel;
  private channel!: Channel;
  private connecting?: Promise<void>;

  async connect(url: string) {
    if (this.conn) return;

    if (this.connecting) {
      await this.connecting;
      return;
    }

    this.connecting = (async () => {
      this.conn = await amqplib.connect(url);
      this.channel = await this.conn.createChannel();
      await this.channel.prefetch(1);
    })();

    await this.connecting;
    this.connecting = undefined;
  }
  /** Publish to `queue`; `data` must match that queue's payload type. */
  async sendEvent<Q extends MQQueues>(queue: Q, data: QueuePayloads[Q]) {
    await this.channel.assertQueue(queue);
    this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(data)));
  }

  /** Consume `queue`; `handler` receives that queue's payload type. */
  async listen<Q extends MQQueues>(
    queue: Q,
    handler: (data: QueuePayloads[Q]) => Promise<void>,
  ) {
    await this.channel.assertQueue(queue);

    this.channel.consume(queue, async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      try {
        // Trusted producers only; the broker carries no schema, so this cast is
        // the boundary where QueuePayloads is asserted rather than verified.
        const data = JSON.parse(msg.content.toString()) as QueuePayloads[Q];
        await handler(data);
        this.channel.ack(msg);
      } catch (err) {
        logger.error("Failed to process message", err, { queue });
        this.channel.nack(msg, false, false);
      }
    });
  }
}

const mq = new MQ();

export async function startMQ() {
  await mq.connect(getBaseEnv().MQ_URL);
}

export { mq };
