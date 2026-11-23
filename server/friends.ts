import type { Peer } from "crossws";
import { and, eq, inArray, or } from "drizzle-orm";
import { type H3Event, HTTPError } from "nitro/h3";
import * as v from "valibot";
import type { PlayerName } from "../src/plays";
import { signed, socketPlayer } from "./auth";
import { db } from "./db";
import { log } from "./log";
import { clean, fold, keyOf, NAME, player, playerId } from "./players";
import {
  Auth,
  Base64,
  count,
  fail,
  failed,
  greet,
  heard,
  roomOf,
  STREAM,
  send,
  serial,
  text,
} from "./rooms";
import * as t from "./schema";

/*
 * Friends. Phigros++ keeps one WebSocket open while it runs (routes/api/friends.ts), signed in like a room's
 * (server/rooms.ts), and talks in JSON objects named by `t`. A player asks another to be their friend ({ t: "add",
 * player }: an id, or a name#0042), who accepts by asking back, and { t: "remove", player } ends it, turns a request
 * down or takes one back. Each change, and each friend coming, going or playing, sends the player their whole list
 * ({ t: "friends", friends }), a refusal is { t: "error", code }.
 *
 * The game says how its player shows ({ t: "status", visible, spectating }: hidden, their friends see them offline)
 * and what they play ({ t: "playing", song, level }, an empty song for nothing). While friends may spectate, it
 * streams the play as it does in a room ({ t: "frames", data }), which a friend hears from its start ({ t: "follow",
 * player, from }). { t: "invite", player } tells a friend of the room the player sits in.
 *
 * What a player asks of others is held to a few times a minute (LIMITS, { t: "error", code: "slow" } past them), and
 * their friends hear how they are every ANNOUNCE at most: nobody floods someone else's game.
 *
 * The site does the same for the profile a browser is signed in to (routes/api/friendships.*.ts): it lists the
 * player's friends, asks, accepts and removes, with the same limits. A browser isn't a game: it never shows online.
 *
 * Who asked whom is kept (a row of friends is a player asking another: they're friends once both asked), who is
 * online only lives in memory.
 *
 * What the sockets, the site's requests and the timers do runs one after the other (`turn`), as most of it reads the
 * database before it acts: a friend removed while they ask to watch is told no, and a list never arrives after a
 * newer one.
 */

const DOMAIN = "phigros.tools friends v1\0"; // the key signs requests, replays and rooms too
const MAX_ASKED = 200; // friends and requests sent
const AWAY = 30_000; // how long a player whose connection dropped stays online
const ANNOUNCE = 2000; // a player's friends hear how they are this often at most
const MINUTE = 60_000;
/** How many times a minute a player may ask for each of these. */
const LIMITS = { add: 10, remove: 30, invite: 6, follow: 30 };
type Limited = keyof typeof LIMITS;

/** A player whose game is open: how they show to their friends, and the play they stream. */
interface Presence {
  player: PlayerName;
  key: Uint8Array;
  /** None while their connection is down, `away` then makes them offline. */
  peer?: Peer;
  away?: ReturnType<typeof setTimeout>;
  visible: boolean;
  spectating: boolean;
  /** `play` tells a play from the next one of the same chart. */
  playing: { id: string; level: string; play: number } | null;
  /** The frames of that play, for whoever follows it late, and those who do. */
  chunks: string[];
  size: number;
  watchers: Set<Presence>;
  follows?: Presence;
  /** When their friends last heard how they are, and what tells them again once ANNOUNCE passed. */
  announced: number;
  announcing?: ReturnType<typeof setTimeout>;
}

interface Session {
  nonce: string;
  presence?: Presence;
}

const online = new Map<string, Presence>(); // by player id
// when each player last asked for each thing that has a limit, within the minute: their game and the site count together
const asking = new Map<string, Partial<Record<Limited, number[]>>>();
const sessions = new Map<Peer, Session>();
let plays = 0;

const turn = serial();
const { friends, players } = t;

// everyone a player asked or was asked by, and which of the two it is
function listed(key: Uint8Array) {
  const asked = db.select({ key: friends.friend }).from(friends).where(eq(friends.player, key));
  const asking = db.select({ key: friends.player }).from(friends).where(eq(friends.friend, key));
  const [mine, theirs] = [inArray(players.key, asked), inArray(players.key, asking)];
  return db
    .select({ player: NAME, mine: mine.mapWith(Boolean), theirs: theirs.mapWith(Boolean) })
    .from(players)
    .where(or(mine, theirs))
    .orderBy(players.fold, players.number);
}

/** A player's friends and requests as their game and the site show them. Only a friend who shows is online. */
export async function friendships(key: Uint8Array) {
  return (await listed(key)).map(({ mine, theirs, player }) => {
    const friend = mine && theirs ? online.get(player.id) : undefined;
    const shown = friend?.visible ? friend : undefined;
    return {
      player,
      state: !theirs ? "outgoing" : mine ? "friend" : "incoming",
      online: shown !== undefined,
      playing: shown?.playing ?? null,
      watch: shown !== undefined && shown.chunks.length > 0,
    };
  });
}

const tell = async (p: Presence | undefined) =>
  p && send(p.peer, { t: "friends", friends: await friendships(p.key) });

// both asked the other
async function friendOf(p: Presence, other: Presence) {
  const asks = (from: Presence, to: Presence) =>
    and(eq(friends.player, from.key), eq(friends.friend, to.key));
  const rows = await db
    .select()
    .from(friends)
    .where(or(asks(p, other), asks(other, p)));
  return rows.length === 2;
}

// the friends whose game is open hear how the player is now. what changes again within ANNOUNCE goes once it passed,
// as it is then: a player flipping how they show, or starting songs over, tells their friends at that pace
async function announce(p: Presence) {
  if (p.announcing) return;
  const wait = p.announced + ANNOUNCE - Date.now();
  if (wait > 0) {
    p.announcing = setTimeout(() => {
      p.announcing = undefined;
      turn(() => announce(p)).catch(failed());
    }, wait);
    return;
  }
  p.announced = Date.now();
  for (const row of await listed(p.key)) {
    const friend = row.mine && row.theirs && online.get(row.player.id);
    if (friend) await tell(friend);
  }
}

// whether the player asked for this as often as a minute allows, which counts this time otherwise
function limited(id: string, kind: Limited) {
  const now = Date.now();
  const asked = asking.get(id) ?? {};
  const times = (asked[kind] ?? []).filter((time) => now - time < MINUTE);
  asked[kind] = times;
  asking.set(id, asked);
  if (times.length >= LIMITS[kind]) return true;
  times.push(now);
  return false;
}

function unfollow(p: Presence) {
  p.follows?.watchers.delete(p);
  p.follows = undefined;
}

// the play is over, or can't be watched any more
function stop(p: Presence) {
  for (const watcher of p.watchers) watcher.follows = undefined;
  p.watchers.clear();
  p.chunks = [];
  p.size = 0;
}

const Message = v.variant("t", [
  Auth,
  v.object({ t: v.literal("status"), visible: v.boolean(), spectating: v.boolean() }),
  v.object({ t: v.literal("add"), player: text(64) }),
  v.object({ t: v.literal("remove"), player: text(16) }),
  v.object({ t: v.literal("playing"), song: text(128), level: text(16) }),
  v.object({ t: v.literal("frames"), data: Base64 }),
  v.object({ t: v.literal("follow"), player: text(16), from: count(100_000) }),
  v.object({ t: v.literal("invite"), player: text(16) }),
]);
type Message = v.InferOutput<typeof Message>;

// the game proves it holds a profile's key. one whose connection dropped is back as it was, another device of the
// player takes their place: the older one is told, and what it played is forgotten
async function auth(peer: Peer, session: Session, m: Extract<Message, { t: "auth" }>) {
  const who = await socketPlayer(DOMAIN, session.nonce, m);
  if (typeof who === "string") {
    log.warn("friends.auth.refused", { code: who });
    return fail(peer, who);
  }
  const p: Presence = online.get(who.player.id) ?? {
    ...who,
    visible: false,
    spectating: false,
    playing: null,
    chunks: [],
    size: 0,
    watchers: new Set(),
    announced: 0,
  };
  if (p.peer && p.peer !== peer) {
    fail(p.peer, "elsewhere");
    stop(p);
    p.playing = null;
  }
  clearTimeout(p.away);
  p.away = undefined;
  p.peer = peer;
  p.player = who.player;
  online.set(p.player.id, p);
  session.presence = p;
  // a game back from a dropped connection hears whether its play is still known
  send(peer, { t: "welcome", player: p.player, playing: p.playing !== null });
  log.info("friends.online", { player: p.player.id });
  await tell(p);
}

// the key of an id or a name#0042
async function keyFor(typed: string) {
  if (/^[0-9a-f]{12}$/.test(typed)) return keyOf(typed);
  const [, name, number] = /^(.*)#(\d{1,4})$/.exec(typed.trim()) ?? [];
  if (name === undefined) return undefined;
  const [tagged] = await db
    .select({ key: players.key })
    .from(players)
    .where(and(eq(players.fold, fold(clean(name))), eq(players.number, Number(number))));
  return tagged?.key;
}

type Who = { player: PlayerName; key: Uint8Array };

/**
 * A player asks another (an id or a name#0042) to be their friend, or accepts their request. Their games hear of it.
 * The code of why not, if any.
 */
export async function befriend(who: Who, typed: string) {
  if (limited(who.player.id, "add")) return "slow";
  const key = await keyFor(typed);
  if (!key) return "unknown";
  if (playerId(key) === who.player.id) return "self";
  const asked = await db.select().from(friends).where(eq(friends.player, who.key));
  if (asked.length >= MAX_ASKED) return "full";
  const added = await db
    .insert(friends)
    .values({ player: who.key, friend: key, added: Date.now() })
    .onConflictDoNothing()
    .returning();
  // asking again changes nothing, and tells nobody
  if (!added.length) return;
  log.info("friends.add", { player: who.player.id, friend: playerId(key) });
  await tell(online.get(playerId(key)));
  await tell(online.get(who.player.id));
}

/** A player ends a friendship, turns a request down or takes one back. The code of why not, if any. */
export async function unfriend(who: Who, id: string) {
  if (limited(who.player.id, "remove")) return "slow";
  const key = await keyOf(id);
  if (!key) return;
  const dropped = await db
    .delete(friends)
    .where(
      or(
        and(eq(friends.player, who.key), eq(friends.friend, key)),
        and(eq(friends.player, key), eq(friends.friend, who.key)),
      ),
    )
    .returning();
  if (!dropped.length) return;
  log.info("friends.remove", { player: who.player.id, friend: id });
  const [mine, other] = [online.get(who.player.id), online.get(id)];
  if (mine && other?.follows === mine) unfollow(other);
  if (mine && other && mine.follows === other) unfollow(mine);
  await tell(other);
  await tell(mine);
}

// why a change was refused, as the site's requests answer it
const REFUSED = { unknown: 404, self: 400, full: 400, slow: 429 };

/** A change the site asks for the signed-in profile, with a player in its body: the list as it is after it. */
export async function changed(event: H3Event, change: typeof befriend) {
  const { key, body } = await signed(event);
  const found = await player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  const typed = new TextDecoder().decode(body).slice(0, 64);
  const why = await turn(() => change({ player: found, key }, typed));
  if (why) throw new HTTPError({ status: REFUSED[why], body: { code: why } });
  return friendships(key);
}

async function act(p: Presence, peer: Peer, m: Exclude<Message, { t: "auth" }>) {
  if ((m.t === "invite" || m.t === "follow") && limited(p.player.id, m.t)) {
    log.warn("friends.limited", { player: p.player.id, kind: m.t });
    return fail(peer, "slow");
  }
  switch (m.t) {
    case "status": {
      const changed = p.visible !== m.visible || p.spectating !== m.spectating;
      Object.assign(p, { visible: m.visible, spectating: m.spectating });
      if (!m.visible || !m.spectating) stop(p);
      if (changed) await announce(p);
      return;
    }
    case "add":
    case "remove": {
      const why = await (m.t === "add" ? befriend(p, m.player) : unfriend(p, m.player));
      if (why) fail(peer, why);
      return;
    }
    case "playing": {
      stop(p);
      const id = clean(m.song, 128);
      plays += 1;
      p.playing = id ? { id, level: clean(m.level, 16), play: plays } : null;
      if (p.visible) await announce(p);
      return;
    }
    case "frames": {
      const watchable = p.playing && p.visible && p.spectating;
      if (!watchable || p.size + m.data.length > STREAM) return;
      p.chunks.push(m.data);
      p.size += m.data.length;
      const told = JSON.stringify({ t: "frames", player: p.player.id, data: m.data });
      for (const watcher of p.watchers) watcher.peer?.send(told);
      // its friends hear that it can be watched
      if (p.chunks.length === 1) await announce(p);
      return;
    }
    case "follow": {
      unfollow(p);
      const friend = online.get(m.player);
      if (!friend?.chunks.length || !(await friendOf(p, friend))) return;
      log.info("friends.watch", { player: p.player.id, friend: m.player });
      p.follows = friend;
      friend.watchers.add(p);
      for (const data of friend.chunks.slice(m.from))
        send(peer, { t: "frames", player: m.player, data });
      return;
    }
    case "invite": {
      const room = roomOf(p.player.id);
      const friend = online.get(m.player);
      if (!room || !friend || !(await friendOf(p, friend))) return;
      log.info("friends.invite", { player: p.player.id, friend: m.player, room: room.id });
      return send(friend.peer, { t: "invite", player: p.player, room: room.id, name: room.name });
    }
  }
}

export function open(peer: Peer) {
  sessions.set(peer, { nonce: greet(peer) });
}

export function message(peer: Peer, raw: string) {
  turn(async () => {
    const session = sessions.get(peer);
    const m = session && heard(peer, Message, raw);
    if (!m) return;
    if (m.t === "auth") return auth(peer, session, m);
    const p = session.presence;
    if (p?.peer !== peer) return fail(peer, "auth");
    await act(p, peer, m);
  }).catch(failed(peer));
}

// a dropped connection stays online for a while: the game connects again, and its friends saw nothing
export function closed(peer: Peer) {
  turn(() => {
    const p = sessions.get(peer)?.presence;
    sessions.delete(peer);
    if (p?.peer !== peer) return;
    p.peer = undefined;
    unfollow(p);
    p.away = setTimeout(() => turn(() => leave(p)).catch(failed()), AWAY);
  }).catch(failed());
}

// by the time its turn comes, the game may be back
async function leave(p: Presence) {
  if (p.peer) return;
  online.delete(p.player.id);
  stop(p);
  log.info("friends.offline", { player: p.player.id });
  if (p.visible) await announce(p);
}

/** How many games are connected and how many players show online, for /admin. */
export const gauges = () => ({ sockets: sessions.size, online: online.size });
