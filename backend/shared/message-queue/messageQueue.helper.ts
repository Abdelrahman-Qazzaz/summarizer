import type { Channel } from "amqplib";

export async function assertDirectDurableExchanges(
  channel: Channel,
  exchanges: readonly string[],
) {
  for (const exchange of exchanges) {
    await channel.assertExchange(exchange, "direct", {
      durable: true,
    });
  }
}

export async function assertDurableQueues(
  channel: Channel,
  queues: readonly string[],
) {
  for (const queue of queues) {
    await channel.assertQueue(queue, {
      durable: true,
    });
  }
}
export async function bindQueues(
  channel: Channel,
  exchange: string,
  queues: readonly string[],
) {
  for (const queue of queues) await channel.bindQueue(queue, exchange, queue);
}
