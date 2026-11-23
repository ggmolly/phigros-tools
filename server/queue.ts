import amqp, { type ConfirmChannel } from "amqplib";
import type { LiveEvent } from "../src/topics";
import { log } from "./log";

/** The queue of uploaded replays waiting to be judged (server/worker.ts), by their sha256. */
export const VERIFY_QUEUE = "replays.verify";
/** What changed, from the server or the worker, for the pages following it (server/live.ts). */
export const EVENTS = "events";
const URL = process.env.AMQP_URL ?? "amqp://localhost";

let channel: Promise<ConfirmChannel> | undefined;

export function openQueue(): Promise<ConfirmChannel> {
  channel ??= amqp
    .connect(URL)
    .then((connection) => {
      // without a listener, a dropped connection's error would crash the server
      connection.on("error", (error) => log.error("queue.error", { error }));
      return connection.createConfirmChannel();
    })
    .then(async (opened) => {
      await opened.assertQueue(VERIFY_QUEUE, { durable: true });
      await opened.assertExchange(EVENTS, "fanout", { durable: false });
      opened.on("close", () => {
        channel = undefined;
        log.warn("queue.closed");
      });
      return opened;
    })
    .catch((error) => {
      channel = undefined;
      throw error;
    });
  return channel;
}

/** Asks the worker to judge a replay. One the broker didn't take still gets judged: the worker starts with every pending one. */
export async function queueVerify(sha256: string) {
  try {
    const opened = await openQueue();
    opened.sendToQueue(VERIFY_QUEUE, Buffer.from(sha256), { persistent: true });
    // resolves once the broker has written it to disk
    await opened.waitForConfirms();
  } catch (error) {
    log.error("queue.verify.failed", { sha256, error });
  }
}

/** Tells the pages following a topic that something changed. A lost one only waits for their next reconnect. */
export async function announce(topic: string, event: LiveEvent = "change", data = "") {
  try {
    (await openQueue()).publish(EVENTS, "", Buffer.from(JSON.stringify({ topic, event, data })));
  } catch (error) {
    log.error("queue.announce.failed", { topic, sent: event, error });
  }
}
