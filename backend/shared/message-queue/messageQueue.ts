import amqplib from "amqplib";
import type { Channel, ChannelModel } from "amqplib";
import { getBaseEnv } from "../env";
import {
  assertDirectDurableExchanges,
  assertDurableQueues,
  bindQueues,
} from "./messageQueue.helper";

const EXCHANGES = {
  MAIN: "main",
  RETRY: "retry",
  DLX: "dead_letter",
} as const;

const QUEUES = {
  TRANSCRIBE: "transcribe",
  TRANSCRIBE_DONE: "transcribe_done",
  YT_FETCH: "yt_fetch",
  YT_FETCH_FAILED: "yt_fetch_failed",
} as const;

async function createMQ() {
  const connection: ChannelModel = await amqplib.connect(getBaseEnv().MQ_URL);

  const channel: Channel = await connection.createChannel();

  await assertDirectDurableExchanges(channel, Object.values(EXCHANGES));

  await assertDurableQueues(channel, Object.values(QUEUES));

  await bindQueues(channel, EXCHANGES.MAIN, Object.values(QUEUES));

  return {
    connection,
    channel,
  };
}
