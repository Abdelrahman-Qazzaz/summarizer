import amqplib from "amqplib";
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import { getBaseEnv } from "../env";
import { logger } from "../logger";
import type { MQQueues } from "../types/mq.types";

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
  } as const;
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
  async sendEvent(queue: MQQueues, data: unknown) {
    await this.channel.assertQueue(queue);
    this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(data)));
  }

  async listen(queue: MQQueues, handler: (data: any) => Promise<void>) {
    await this.channel.assertQueue(queue);

    this.channel.consume(queue, async (msg: ConsumeMessage | null) => {
      if (!msg) return;

      try {
        const data = JSON.parse(msg.content.toString());
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
