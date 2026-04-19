import amqplib from "amqplib";
import type { Channel, ChannelModel, ConsumeMessage } from "amqplib";

class MQ {
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
    })();

    await this.connecting;
    this.connecting = undefined;
  }
  async sendEvent(queue: string, data: unknown) {
    await this.channel.assertQueue(queue);
    this.channel.sendToQueue(queue, Buffer.from(JSON.stringify(data)));
  }

  async listen(queue: string, handler: (data: any) => void) {
    await this.channel.assertQueue(queue);

    this.channel.consume(queue, (msg: ConsumeMessage | null) => {
      if (!msg) return;

      try {
        const data = JSON.parse(msg.content.toString());
        handler(data);
        this.channel.ack(msg);
      } catch (err) {
        console.error("Failed to process message", err);
      }
    });
  }
}

const mq = new MQ();
await mq.connect(process.env.MQ_URL!);
export { mq };
