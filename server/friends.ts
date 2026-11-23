import type { Peer } from "crossws";
import { type H3Event, HTTPError } from "nitro/h3";
import * as v from "valibot";
import type { PlayerName } from "../src/plays";
import { signed, socketPlayer } from "./auth";
import { sqlite } from "./db";
import { clean, fold, keyOf, player, playerId } from "./players";
import { Auth, Base64, count, fail, greet, heard, roomOf, STREAM, send, text } from "./rooms";

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
 * Who asked whom is kept, who is online only lives in memory.
 */

// a row is a player asking another: they're friends once both asked
sqlite.run(`
  CREATE TABLE IF NOT EXISTS friends (
    player BLOB NOT NULL,
    friend BLOB NOT NULL,
    added INTEGER NOT NULL,
    PRIMARY KEY (player, friend)
  ) WITHOUT ROWID
`);
sqlite.run("CREATE INDEX IF NOT EXISTS idx_friends_friend ON friends(friend)");

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

const listed = sqlite.prepare<PlayerName & { mine: number; theirs: number }, [Uint8Array]>(
  `SELECT p.id, p.name, p.number, p.avatar, MAX(f.mine) AS mine, MAX(f.theirs) AS theirs
   FROM (SELECT friend AS key, 1 AS mine, 0 AS theirs FROM friends WHERE player = ?1
         UNION ALL SELECT player, 0, 1 FROM friends WHERE friend = ?1) f
   JOIN players p ON p.key = f.key GROUP BY p.key ORDER BY p.fold, p.number`,
);
const asked = sqlite.prepare<{ count: number }, [Uint8Array]>(
  "SELECT COUNT(*) AS count FROM friends WHERE player = ?",
);
const ask = sqlite.prepare<unknown, [Uint8Array, Uint8Array, number]>(
  "INSERT OR IGNORE INTO friends (player, friend, added) VALUES (?, ?, ?)",
);
const drop = sqlite.prepare<unknown, [Uint8Array, Uint8Array]>(
  "DELETE FROM friends WHERE (player = ?1 AND friend = ?2) OR (player = ?2 AND friend = ?1)",
);
const tagged = sqlite.prepare<{ key: Uint8Array }, [string, number]>(
  "SELECT key FROM players WHERE fold = ? AND number = ?",
);

/** A player's friends and requests as their game and the site show them. Only a friend who shows is online. */
export function friendships(key: Uint8Array) {
  return listed.all(key).map(({ mine, theirs, ...player }) => {
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

const tell = (p: Presence | undefined) =>
  p && send(p.peer, { t: "friends", friends: friendships(p.key) });

const friendOf = (p: Presence, other: Presence) =>
  listed.all(p.key).some((row) => row.id === other.player.id && row.mine && row.theirs);

// the friends whose game is open hear how the player is now. what changes again within ANNOUNCE goes once it passed,
// as it is then: a player flipping how they show, or starting songs over, tells their friends at that pace
function announce(p: Presence) {
  if (p.announcing) return;
  const wait = p.announced + ANNOUNCE - Date.now();
  if (wait > 0) {
    p.announcing = setTimeout(() => {
      p.announcing = undefined;
      announce(p);
    }, wait);
    return;
  }
  p.announced = Date.now();
  for (const row of listed.all(p.key)) {
    const friend = row.mine && row.theirs && online.get(row.id);
    if (friend) tell(friend);
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
function auth(peer: Peer, session: Session, m: Extract<Message, { t: "auth" }>) {
  const who = socketPlayer(DOMAIN, session.nonce, m);
  if (typeof who === "string") return fail(peer, who);
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
  tell(p);
}

// the key of an id or a name#0042
function keyFor(typed: string) {
  if (/^[0-9a-f]{12}$/.test(typed)) return keyOf(typed);
  const [, name, number] = /^(.*)#(\d{1,4})$/.exec(typed.trim()) ?? [];
  return name === undefined ? undefined : tagged.get(fold(clean(name)), Number(number))?.key;
}

type Who = { player: PlayerName; key: Uint8Array };

/**
 * A player asks another (an id or a name#0042) to be their friend, or accepts their request. Their games hear of it.
 * The code of why not, if any.
 */
export function befriend(who: Who, typed: string) {
  if (limited(who.player.id, "add")) return "slow";
  const key = keyFor(typed);
  if (!key) return "unknown";
  if (playerId(key) === who.player.id) return "self";
  if (asked.get(who.key)!.count >= MAX_ASKED) return "full";
  // asking again changes nothing, and tells nobody
  if (!ask.run(who.key, key, Date.now()).changes) return;
  tell(online.get(playerId(key)));
  tell(online.get(who.player.id));
}

/** A player ends a friendship, turns a request down or takes one back. The code of why not, if any. */
export function unfriend(who: Who, id: string) {
  if (limited(who.player.id, "remove")) return "slow";
  const key = keyOf(id);
  if (!key || !drop.run(who.key, key).changes) return;
  const [mine, other] = [online.get(who.player.id), online.get(id)];
  if (mine && other?.follows === mine) unfollow(other);
  if (mine && other && mine.follows === other) unfollow(mine);
  tell(other);
  tell(mine);
}

// why a change was refused, as the site's requests answer it
const REFUSED = { unknown: 404, self: 400, full: 400, slow: 429 };

/** A change the site asks for the signed-in profile, with a player in its body: the list as it is after it. */
export async function changed(event: H3Event, change: typeof befriend) {
  const { key, body } = await signed(event);
  const found = player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  const why = change({ player: found, key }, new TextDecoder().decode(body).slice(0, 64));
  if (why) throw new HTTPError({ status: REFUSED[why], body: { code: why } });
  return friendships(key);
}

function act(p: Presence, peer: Peer, m: Exclude<Message, { t: "auth" }>) {
  if ((m.t === "invite" || m.t === "follow") && limited(p.player.id, m.t))
    return fail(peer, "slow");
  switch (m.t) {
    case "status": {
      const changed = p.visible !== m.visible || p.spectating !== m.spectating;
      Object.assign(p, { visible: m.visible, spectating: m.spectating });
      if (!m.visible || !m.spectating) stop(p);
      if (changed) announce(p);
      return;
    }
    case "add":
    case "remove": {
      const why = m.t === "add" ? befriend(p, m.player) : unfriend(p, m.player);
      if (why) fail(peer, why);
      return;
    }
    case "playing": {
      stop(p);
      const id = clean(m.song, 128);
      plays += 1;
      p.playing = id ? { id, level: clean(m.level, 16), play: plays } : null;
      if (p.visible) announce(p);
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
      if (p.chunks.length === 1) announce(p);
      return;
    }
    case "follow": {
      unfollow(p);
      const friend = online.get(m.player);
      if (!friend?.chunks.length || !friendOf(p, friend)) return;
      p.follows = friend;
      friend.watchers.add(p);
      for (const data of friend.chunks.slice(m.from))
        send(peer, { t: "frames", player: m.player, data });
      return;
    }
    case "invite": {
      const room = roomOf(p.player.id);
      const friend = online.get(m.player);
      if (!room || !friend || !friendOf(p, friend)) return;
      return send(friend.peer, { t: "invite", player: p.player, room: room.id, name: room.name });
    }
  }
}

export function open(peer: Peer) {
  sessions.set(peer, { nonce: greet(peer) });
}

export function message(peer: Peer, raw: string) {
  const session = sessions.get(peer);
  const m = session && heard(peer, Message, raw);
  if (!m) return;
  if (m.t === "auth") return auth(peer, session, m);
  const p = session.presence;
  if (p?.peer !== peer) return fail(peer, "auth");
  act(p, peer, m);
}

// a dropped connection stays online for a while: the game connects again, and its friends saw nothing
export function closed(peer: Peer) {
  const p = sessions.get(peer)?.presence;
  sessions.delete(peer);
  if (p?.peer !== peer) return;
  p.peer = undefined;
  unfollow(p);
  p.away = setTimeout(() => {
    online.delete(p.player.id);
    stop(p);
    if (p.visible) announce(p);
  }, AWAY);
}
