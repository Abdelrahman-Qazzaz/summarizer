import amqplib from "amqplib";
import type {
  Channel,
  ChannelModel,
  ConfirmChannel,
  ConsumeMessage,
} from "amqplib";
import { getBaseEnv } from "../env";
import { logger, messageOf } from "../logger";
import { QUEUES, type Queue, type QueuePayloads } from "./queues";
export { QUEUES } from "./queues";

const log = logger.child({ component: "message-queue" });

const MAIN_EXCHANGE = "main";

/**
 * Where a message that failed for good is kept, as it arrived, under the name
 * of the queue it came from. The exchange and the queue share this name.
 * Nothing consumes the queue: it is for inspecting, and replaying by hand once
 * the cause is fixed.
 */
const DEAD_LETTER = "dead_letter";

/** How long to wait before trying a failed message again, to ride out a brief outage. */
const RETRY_DELAY_MS = 2_000;

export type DeliveryMetadata = {
  /** 1 on the first try, counting up to the attempts the consumer allows. */
  attempt: number;
  /** A failure now dead-letters the message instead of trying again. */
  lastAttempt: boolean;
  /**
   * The broker delivered this message before, to a process that stopped
   * before settling it: that process may have started work on it.
   */
  redelivered: boolean;
};

type Handler<Q extends Queue> = (
  payload: QueuePayloads[Q],
  delivery: DeliveryMetadata,
) => Promise<void> | void;

/**
 * Thrown by a handler to dead-letter its message straight away, skipping the
 * attempts it has left: for a failure trying again can't fix, or one that
 * leaves nothing safe for the next attempt to pick up.
 */
export class DeadLetterError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DeadLetterError";
  }
}

type Broker = {
  connection: ChannelModel;
  publisher: ConfirmChannel;
  consumer: Channel;
  consumerTags: string[];
  /** Handlers still running, for stopConsuming to wait on. */
  running: Set<Promise<void>>;
  /** Set by close(), so the connection going away isn't taken for a loss. */
  closing: boolean;
};

async function open(url: string): Promise<Broker> {
  const connection = await amqplib.connect(url);
  const broker: Broker = {
    connection,
    publisher: await connection.createConfirmChannel(),
    consumer: await connection.createChannel(),
    consumerTags: [],
    running: new Set(),
    closing: false,
  };
  exitOnLoss(broker);

  // Every queue is bound under its own name twice: to the main exchange for
  // work, and to the dead-letter exchange for the queue holding what failed.
  const { publisher } = broker;
  await publisher.assertExchange(MAIN_EXCHANGE, "direct", { durable: true });
  await publisher.assertExchange(DEAD_LETTER, "direct", { durable: true });
  await publisher.assertQueue(DEAD_LETTER, { durable: true });
  for (const queue of Object.values(QUEUES)) {
    await publisher.assertQueue(queue, { durable: true });
    await publisher.bindQueue(queue, MAIN_EXCHANGE, queue);
    await publisher.bindQueue(DEAD_LETTER, DEAD_LETTER, queue);
  }

  await broker.consumer.prefetch(1);
  return broker;
}

/**
 * Nothing here reconnects. A lost connection or channel would otherwise
 * leave the process running with nothing that can publish or consume, so it
 * exits instead and the platform restarts it; startup then waits out a broker
 * that is still down by failing its preflight.
 *
 * The connection closes its channels before it reports why it closed, so the
 * exit waits a turn for that reason to arrive and logs it.
 */
function exitOnLoss(broker: Broker) {
  let cause: unknown;
  let exiting = false;

  const lost = (name: string) => (error?: unknown) => {
    cause ??= error;
    if (broker.closing || exiting) return;
    exiting = true;
    setImmediate(() => {
      log.error(`RabbitMQ ${name} lost, exiting`, cause);
      process.exit(1);
    });
  };

  for (const [resource, name] of [
    [broker.connection, "connection"],
    [broker.publisher, "publisher channel"],
    [broker.consumer, "consumer channel"],
  ] as const) {
    resource.on("error", lost(name));
    resource.on("close", lost(name));
  }
}

/** Resolves once the broker confirms it has the message. */
function publishConfirmed(
  broker: Broker,
  exchange: string,
  queue: Queue,
  content: Buffer,
  headers?: Record<string, string>,
) {
  return new Promise<void>((resolve, reject) => {
    broker.publisher.publish(
      exchange,
      queue,
      content,
      { contentType: "application/json", persistent: true, headers },
      (error) => {
        if (error) reject(error);
        else resolve();
      },
    );
  });
}

/** Why a message failed, with the cause a DeadLetterError wraps. */
function failureReason(error: unknown) {
  const cause = error instanceof Error ? error.cause : undefined;
  return cause === undefined
    ? messageOf(error)
    : `${messageOf(error)}: ${messageOf(cause)}`;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parks a message that failed for good in the dead-letter queue, then acks
 * it. If the broker won't take it there, the message is dropped: requeueing
 * it instead would run the handler again on every delivery for as long as
 * dead-lettering keeps failing.
 */
async function deadLetter(
  broker: Broker,
  queue: Queue,
  message: ConsumeMessage,
  error: unknown,
) {
  log.error("Failed to process message, dead-lettering it", error, { queue });
  try {
    await publishConfirmed(broker, DEAD_LETTER, queue, message.content, {
      "x-failure-reason": failureReason(error),
    });
  } catch (deadLetterError) {
    log.error("Could not dead-letter message, dropping it", deadLetterError, {
      queue,
      payload: message.content.toString(),
    });
    broker.consumer.nack(message, false, false);
    return;
  }
  broker.consumer.ack(message);
}

/**
 * Runs the handler until it succeeds or runs out of attempts, pausing between
 * them. A message that fails every attempt, throws a DeadLetterError, or
 * isn't valid JSON is dead-lettered.
 */
async function handle<Q extends Queue>(
  broker: Broker,
  queue: Q,
  message: ConsumeMessage,
  handler: Handler<Q>,
  attempts: number,
) {
  let payload: QueuePayloads[Q];
  try {
    payload = JSON.parse(message.content.toString());
  } catch (error) {
    const malformed = new DeadLetterError("Malformed payload", {
      cause: error,
    });
    await deadLetter(broker, queue, message, malformed);
    return;
  }

  const { redelivered } = message.fields;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const lastAttempt = attempt === attempts;
    try {
      await handler(payload, { attempt, lastAttempt, redelivered });
      broker.consumer.ack(message);
      return;
    } catch (error) {
      if (lastAttempt || error instanceof DeadLetterError) {
        await deadLetter(broker, queue, message, error);
        return;
      }
      log.warn("Failed to process message, trying again", {
        queue,
        attempt,
        error: messageOf(error),
      });
      await sleep(RETRY_DELAY_MS);
    }
  }
}

/**
 * Startup health check: fails if RabbitMQ is unreachable or refuses the
 * credentials. The topology is declared when the process first uses mq.
 */
export async function pingMQ() {
  const connection = await amqplib.connect(getBaseEnv().MQ_URL);
  await connection.close();
}

let opening: Promise<Broker> | undefined;

function getBroker() {
  opening ??= open(getBaseEnv().MQ_URL);
  return opening;
}

export const mq = {
  queues: QUEUES,

  async publish<Q extends Queue>(queue: Q, payload: QueuePayloads[Q]) {
    await publishConfirmed(
      await getBroker(),
      MAIN_EXCHANGE,
      queue,
      Buffer.from(JSON.stringify(payload)),
    );
  },

  /**
   * Hands each message on `queue` to `handler`, trying up to `attempts` times
   * before dead-lettering it. A handler fails an attempt by throwing.
   */
  async consume<Q extends Queue>(
    queue: Q,
    handler: Handler<Q>,
    { attempts }: { attempts: number },
  ) {
    if (!Number.isInteger(attempts) || attempts < 1) {
      throw new Error(`A consumer needs at least one attempt, got ${attempts}`);
    }

    const broker = await getBroker();
    const { consumerTag } = await broker.consumer.consume(queue, (message) => {
      if (!message) return;
      const handling = handle(broker, queue, message, handler, attempts);
      broker.running.add(handling);
      void handling.finally(() => broker.running.delete(handling));
    });
    broker.consumerTags.push(consumerTag);
  },

  /**
   * Stops every consumer, so the broker delivers nothing more, then waits for
   * the handlers already running. What they were given is still settled.
   */
  async stopConsuming() {
    if (!opening) return;

    const broker = await opening;
    const consumerTags = broker.consumerTags.splice(0);
    await Promise.all(consumerTags.map((tag) => broker.consumer.cancel(tag)));
    await Promise.allSettled(broker.running);
  },

  async close() {
    if (!opening) return;

    const broker = await opening;
    opening = undefined;
    broker.closing = true;
    await broker.connection.close();
  },
};
