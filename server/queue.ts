import amqp, { type ConfirmChannel } from "amqplib";

/** The queue of uploaded replays waiting to be judged (server/worker.ts), by their sha256. */
export const VERIFY_QUEUE = "replays.verify";
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
