import amqp, { type ConfirmChannel } from "amqplib";

/** The queue of uploaded replays waiting to be judged (server/worker.ts), by their sha256. */
export const VERIFY_QUEUE = "replays.verify";
/** What changed for a player, from the server or the worker, for the pages open on them (server/events.ts). */
export const EVENTS = "events";
const URL = process.env.AMQP_URL ?? "amqp://localhost";

let channel: Promise<ConfirmChannel> | undefined;

export function openQueue(): Promise<ConfirmChannel> {
  channel ??= amqp
    .connect(URL)
    .then((connection) => {
      // without a listener, a dropped connection's error would crash the server
      connection.on("error", (error) => console.error("queue connection lost:", error));
      return connection.createConfirmChannel();
    })
    .then(async (opened) => {
      await opened.assertQueue(VERIFY_QUEUE, { durable: true });
      await opened.assertExchange(EVENTS, "fanout", { durable: false });
      opened.on("close", () => {
        channel = undefined;
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
    console.error(`replay ${sha256} not queued:`, error);
  }
}

/** A player's event: "save" with the upload time when their game sent a save, "change" for anything else they show. */
export type LiveEvent = "save" | "change";

/** Tells the pages open on a player that something changed. A lost one only waits for their next reconnect. */
export async function announce(id: string, event: LiveEvent, data = "") {
  try {
    (await openQueue()).publish(EVENTS, "", Buffer.from(JSON.stringify({ id, event, data })));
  } catch (error) {
    console.error(`event ${event} of ${id} not sent:`, error);
  }
}
