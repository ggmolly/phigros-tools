import type { Peer } from "crossws";
import type { LiveEvent } from "../src/topics";
import { log } from "./log";
import { EVENTS, openQueue } from "./queue";
import { savedAt } from "./saves";

// the pages open on the site, each following the topics it shows (src/topics.ts) through one WebSocket. what changes
// comes through the broker's EVENTS exchange, so the worker's events reach them too (see announce)
const followers = new Map<string, Set<Peer>>();

let consuming = false;

export function consume() {
  if (consuming) return;
  consuming = true;
  openQueue()
    .then(async (channel) => {
      // the pages reconnect, which consumes again and fetches what they missed
      channel.on("close", () => {
        consuming = false;
        log.warn("live.broker.lost", { topics: followers.size });
        for (const peers of followers.values()) for (const peer of peers) peer.close(1012);
      });
      const { queue } = await channel.assertQueue("", { exclusive: true, autoDelete: true });
      await channel.bindQueue(queue, EVENTS, "");
      await channel.consume(
        queue,
        (message) => {
          if (!message) return;
          const text = message.content.toString();
          const { topic } = JSON.parse(text) as { topic: string; event: LiveEvent; data: string };
          for (const peer of followers.get(topic) ?? []) peer.send(text);
        },
        { noAck: true },
      );
    })
    .catch((error) => {
      consuming = false;
      log.error("live.broker.failed", { error });
    });
}

function unfollow(peer: Peer, topic: string) {
  peer.unsubscribe(topic);
  const peers = followers.get(topic);
  peers?.delete(peer);
  if (!peers?.size) followers.delete(topic);
}

/**
 * A page follows these topics, and no others. A player's starts with when their save was uploaded, so a reconnect
 * catches up.
 */
export function follow(peer: Peer, topics: string[]) {
  for (const topic of peer.topics) if (!topics.includes(topic)) unfollow(peer, topic);
  for (const topic of topics) {
    if (peer.topics.has(topic)) continue;
    peer.subscribe(topic);
    followers.set(topic, (followers.get(topic) ?? new Set()).add(peer));
    if (!topic.startsWith("player:")) continue;
    savedAt(topic.slice("player:".length), "saves")
      .then((at) => {
        // the page may have left for another one meanwhile
        if (peer.topics.has(topic))
          peer.send(JSON.stringify({ topic, event: "save", data: String(at ?? 0) }));
      })
      .catch((error) => log.error("live.save.failed", { error }));
  }
}

/** How many topics are followed, for /admin. */
export const gauges = () => ({ topics: followers.size });

export const leave = (peer: Peer) => follow(peer, []);
