import type { Channel } from "amqplib";
type Topology = {
  exchanges: readonly string[];
  queues: readonly string[];
  mainExchange: string;
};

export async function setupTopology(
  channel: Channel,
  topology: Topology,
): Promise<void> {
  for (const exchange of topology.exchanges) {
    await channel.assertExchange(exchange, "direct", {
      durable: true,
    });
  }

  for (const queue of topology.queues) {
    await channel.assertQueue(queue, {
      durable: true,
    });

    await channel.bindQueue(queue, topology.mainExchange, queue);
  }
}
