import amqplib from "amqplib";
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";
import type { MQQueues } from "../types/mq.types";

class MQ {
  queues = {
    TRANSCRIBE: "transcribe",
    SUMMARIZE: "summarize",
    TRANSCRIBE_DONE: "transcribe_done",
    SUMMARIZE_DONE: "summarize_done",
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
        console.error("Failed to process message", err);
        this.channel.nack(msg, false, false);
      }
    });
  }
}

const mq = new MQ();
await mq.connect(process.env.MQ_URL!);

export async function startMQ() {
  await mq.connect(process.env.MQ_URL!);

  mq.listen(mq.queues.SUMMARIZE_DONE, async ({ uploadId }) => {
    console.log("Summary done:", uploadId);
    // notify(uploadId, { type: "summarize_done", uploadId });
  });
}



export { mq };
