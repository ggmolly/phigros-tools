import { EventStream, type H3Event } from "nitro/h3";
import { EVENTS, type LiveEvent, openQueue } from "./queue";
import { savedAt } from "./saves";

// the pages open on each player, as server-sent events. what changes comes through the broker's EVENTS exchange, so
// the worker's events reach them too (see announce)
const streams = new Map<string, Set<EventStream>>();
const HEARTBEAT = 25_000;

let consuming = false;

function consume() {
  if (consuming) return;
  consuming = true;
  openQueue()
    .then(async (channel) => {
      // the browsers reconnect, which consumes again and fetches what they missed
      channel.on("close", () => {
        consuming = false;
        for (const open of streams.values()) for (const stream of open) void stream.close();
      });
      const { queue } = await channel.assertQueue("", { exclusive: true, autoDelete: true });
      await channel.bindQueue(queue, EVENTS, "");
      await channel.consume(
        queue,
        (message) => {
          if (!message) return;
          const { id, event, data } = JSON.parse(message.content.toString()) as {
            id: string;
            event: LiveEvent;
            data: string;
          };
          for (const stream of streams.get(id) ?? []) void stream.push({ event, data });
        },
        { noAck: true },
      );
    })
    .catch((error) => {
      consuming = false;
      console.error("events not received:", error);
    });
}

/** A stream of a player's events, starting with when their save was uploaded so a reconnect catches up. */
export function listen(event: H3Event, id: string) {
  consume();
  const stream = new EventStream(event);
  const open = streams.get(id) ?? new Set();
  streams.set(id, open.add(stream));
  void stream.push({ event: "save", data: String(savedAt(id, "saves") ?? 0) });
  const heartbeat = setInterval(() => void stream.pushComment(""), HEARTBEAT);
  stream.onClosed(() => {
    clearInterval(heartbeat);
    open.delete(stream);
    if (!open.size) streams.delete(id);
  });
  return stream;
}
