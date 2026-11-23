import { randomBytes, randomInt } from "node:crypto";
import type { Peer } from "crossws";
import { desc, eq, inArray } from "drizzle-orm";
import * as v from "valibot";
import { canonicalSongId, catalogSong } from "../src/catalog";
import { totalOf, validMods } from "../src/modifiers";
import { LEVELS } from "../src/modules";
import type { PlayerName } from "../src/plays";
import {
  type Match,
  type MatchPlay,
  ROOM_CHAT,
  ROOM_NAME,
  ROOM_PLAYERS,
  ROOM_QUEUE,
  ROOM_QUEUE_EACH,
  ROOM_SPECTATORS,
  ROOM_WATCHERS,
  type RoomChart,
  type RoomPage,
  type RoomSummary,
  type RoomView,
  type Standing,
} from "../src/rooms";
import { topics } from "../src/topics";
import { socketPlayer } from "./auth";
import { db } from "./db";
import { log } from "./log";
import { clean, NAME } from "./players";
import { announce } from "./queue";
import * as t from "./schema";

/*
 * Multiplayer rooms. Phigros++ keeps one WebSocket open (routes/api/room.ts) and talks in JSON objects named by `t`.
 * The server greets with a nonce ({ t: "hello", nonce }) that the game signs with its profile's key ({ t: "auth", key,
 * sig }, both hex), then the player makes or joins a room. Every change of a room goes to its players whole
 * ({ t: "room", room }, null once they're out of it), a refusal is { t: "error", code }.
 *
 * In a room, anyone adds charts ({ t: "queue" }): the room is on the first, the others wait after it, and the one who
 * added a chart or the host takes it back ({ t: "unqueue" }), and the host orders the queue ({ t: "move" }). Each player plays the chart with the level and
 * modifiers it was added with, or their own ({ t: "pick" }), and says whether their game has it at that level and when
 * they're ready. The host starts once everyone who has it is ready ({ t: "start", seed } to those who play). Players
 * send their score as they play, which the room hears about once a second, and their result at the end: the match is
 * over when nobody plays any more, and the room goes to the next chart queued. Chat lines go to the room's players and
 * nowhere else. The host may rename the room or hand it to another player.
 *
 * A player may spectate instead ({ t: "spectate" }), and a browser may watch a room without signing in ({ t: "watch",
 * room, password }), unlisted and never told the chat. Players stream what they play as they play it ({ t: "frames",
 * data }: a replay of the frames since the last one, in base64), and those who spectate or watch hear the stream of the
 * player they follow ({ t: "follow", player, from }), from its start when they follow mid-match, or from the part they
 * miss when their connection dropped.
 *
 * Rooms live in memory, the matches of those without a password are kept: the site shows both (src/rooms.ts).
 *
 * A room changes without waiting for the database, so what its players do stays in the order they did it. Only who a
 * socket is and a new room's id are read from it first, each socket's messages waiting their turn meanwhile.
 */

const DOMAIN = "phigros.tools rooms v1\0"; // the key signs requests and replays too
const MAX_ROOMS = 500;
const MAX_MESSAGE = 16_384; // frames are the longest
/** What is kept of a play's frames while it's played, a long song takes about a tenth. */
export const STREAM = 4_000_000;
const GUESS_PAUSE = 1000; // a wrong password, and the room takes no other for this long
const AWAY = 30_000; // how long a player whose connection dropped keeps their place
const MATCH_LIMIT = 20 * 60_000; // a match nobody ends is over after this
const SCORES_PUSH = 1000; // the room and the site hear of scores this often at most
const CHAT_PAUSE = 500;
const PAGE_MATCHES = 100;
const ID_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
// a scheme or www. and what follows, or anything ending like a domain
const URLS = /(?:[a-z][a-z\d+.-]*:\/\/|www\.)\S*|[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}(?:\/\S*)?/giu;

type Timer = ReturnType<typeof setTimeout>;

interface Seat {
  player: PlayerName;
  key: Uint8Array;
  room: Room;
  /** None while their connection is down, `away` then removes them. */
  peer?: Peer;
  away?: Timer;
  ready: boolean;
  /** What they play the room's chart with: as it was added, until they pick. */
  level: string;
  mods: number;
  able: boolean;
  watching: boolean;
  /** The player whose frames they hear, when watching. */
  follows: string;
  playing: boolean;
  score: number;
  accuracy: number;
  combo: number;
  chatted: number;
}

/** A browser watching a room. */
interface Watcher {
  peer: Peer;
  room: Room;
  follows: string;
}

interface Room {
  id: string;
  name: string;
  password: string;
  /** The id of the player who picks the chart and starts. */
  host: string;
  /** In the order they joined: the first one left becomes the host. */
  seats: Seat[];
  banned: Set<string>;
  /** The chart it's on, whether a match played it already, the ones waiting after it, and how many were added. */
  chart: RoomChart | null;
  played: boolean;
  queue: RoomChart[];
  entries: number;
  last: Match | null;
  playing: boolean;
  /** The match being played: its results as they come, and what ends it when it takes too long. */
  results: { seat: Seat; result: Omit<MatchPlay, "player" | "rank"> }[];
  /** The frames of the match being played by player id, for whoever follows one late. */
  streams: Map<string, { chunks: string[]; size: number }>;
  watchers: Set<Watcher>;
  /** When it was last given a wrong password. */
  guessed: number;
  limit?: Timer;
  /** A push to the site that waits, and the summary the list last heard. */
  pushing?: Timer;
  listed: string;
}

interface Session {
  nonce: string;
  player?: PlayerName;
  key?: Uint8Array;
  /** What the socket said runs in the order it said it. */
  turn: ReturnType<typeof serial>;
}

/** Runs what it's given one after the other, each waiting for the one before to end. */
export function serial() {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(work: () => T | Promise<T>): Promise<T> => {
    const done = last.then(work);
    last = done.catch(() => undefined);
    return done;
  };
}

/** What a socket's turn does when it throws: the game hears it by losing the connection, and connects again. */
export const failed = (peer?: Peer) => (error: unknown) => {
  log.error("socket.failed", { error });
  peer?.close(1011, "Try again");
};

const rooms = new Map<string, Room>();
const seated = new Map<string, Seat>(); // by player id: a player sits in one room
const sessions = new Map<Peer, Session>();
const watching = new Map<Peer, Watcher>();

// what the game's sockets share (server/friends.ts is the other one)
export const send = (peer: Peer | undefined, message: object) =>
  peer?.send(JSON.stringify(message));
export const fail = (peer: Peer, code: string) => send(peer, { t: "error", code });

function view(room: Room): RoomView {
  return {
    id: room.id,
    name: room.name,
    locked: room.password !== "",
    host: room.host,
    playing: room.playing,
    chart: room.chart,
    queue: room.queue,
    players: room.seats.map((seat) => ({
      player: seat.player,
      ready: seat.ready,
      level: seat.level,
      mods: seat.mods,
      able: seat.able,
      watching: seat.watching,
      playing: seat.playing,
      score: seat.score,
      accuracy: seat.accuracy,
      combo: seat.combo,
    })),
    watchers: room.watchers.size,
    last: room.last,
  };
}

const players = (room: Room) => room.seats.filter((seat) => !seat.watching).length;

function summary(room: Room): RoomSummary {
  const locked = room.password !== "";
  return {
    id: room.id,
    name: room.name,
    locked,
    playing: room.playing,
    players: players(room),
    chart: locked ? null : room.chart,
  };
}

// the site hears how the room is now, and the list when what it shows of it changed
function publish(room: Room) {
  clearTimeout(room.pushing);
  room.pushing = undefined;
  if (!room.password) void announce(topics.room(room.id), "room", JSON.stringify(view(room)));
  const listed = JSON.stringify(summary(room));
  if (listed === room.listed) return;
  room.listed = listed;
  void announce(topics.rooms);
}

function push(room: Room) {
  const text = JSON.stringify({ t: "room", room: view(room) });
  for (const each of [...room.seats, ...room.watchers]) each.peer?.send(text);
  publish(room);
}

// what a room plays, for the log: with a password it stays between its players
const played = (room: Room, { song, level, mods }: RoomChart) =>
  room.password ? {} : { song, difficulty: level, mods };

// the room is on another chart, none once its queue is empty: everyone plays it as it was added until they pick
// otherwise. a game says again whether it has it, an older one only when the song or the level changed
function turn(room: Room, chart: RoomChart | null) {
  const same = room.chart?.id === chart?.id && room.chart?.level === chart?.level;
  room.chart = chart;
  room.played = false;
  for (const seat of room.seats) {
    seat.ready = false;
    seat.able ||= !same;
    if (chart) Object.assign(seat, { level: chart.level, mods: chart.mods });
  }
}

// the match is over: its plays are ranked, and kept when the room has no password and the site knows the chart. the
// room goes to the next chart queued, and stays on this one for another match when there's none
function finish(room: Room) {
  clearTimeout(room.limit);
  room.playing = false;
  for (const seat of room.seats) seat.ready = seat.playing = false;
  room.streams.clear();
  const results = room.results.sort(
    (a, b) => b.result.total - a.result.total || b.result.accuracy - a.result.accuracy,
  );
  room.results = [];
  const chart = room.chart!;
  room.played = true;
  if (room.queue.length) turn(room, room.queue.shift()!);
  if (!results.length) return;
  const match: Match = {
    id: 0,
    song: chart.song,
    level: chart.level,
    mods: chart.mods,
    date: Date.now(),
    plays: results.map(({ seat, result }, index) => ({
      ...result,
      player: seat.player,
      rank: index + 1,
    })),
  };
  room.last = match;
  const kept = !room.password && catalogSong(chart.song) !== undefined;
  log.info("room.match.finish", {
    room: room.id,
    plays: results.length,
    kept,
    ...played(room, chart),
  });
  if (!kept) return;
  const plays = results.map(({ seat, result: { total, ...result } }, place) => ({
    ...result,
    key: seat.key,
    place,
  }));
  // kept behind the room's back: the site hears of the match once it's there
  keep(room, match, plays).catch((error) => log.error("room.match.lost", { room: room.id, error }));
}

async function keep(
  room: Room,
  match: Match,
  plays: Omit<typeof t.match_plays.$inferInsert, "match">[],
) {
  const { song, level, mods, date: played } = match;
  match.id = await db.transaction(async (tx) => {
    const [{ id }] = await tx
      .insert(t.matches)
      .values({ room: room.id, name: room.name, song, level, mods, played })
      .returning({ id: t.matches.id });
    await tx.insert(t.match_plays).values(plays.map((play) => ({ ...play, match: id })));
    return id;
  });
  await announce(topics.room(room.id));
}

function close(room: Room) {
  log.info("room.close", { room: room.id });
  clearTimeout(room.limit);
  clearTimeout(room.pushing);
  rooms.delete(room.id);
  for (const watcher of room.watchers) {
    watching.delete(watcher.peer);
    send(watcher.peer, { t: "room", room: null });
  }
  void announce(topics.rooms);
  void announce(topics.room(room.id));
}

// after what may end the match or empty the room
function settle(room: Room) {
  if (room.playing && !room.seats.some((seat) => seat.playing)) finish(room);
  if (room.seats.length) push(room);
  else close(room);
}

function leave(seat: Seat) {
  const room = seat.room;
  clearTimeout(seat.away);
  seated.delete(seat.player.id);
  room.seats.splice(room.seats.indexOf(seat), 1);
  send(seat.peer, { t: "room", room: null });
  if (room.host === seat.player.id && room.seats.length) room.host = room.seats[0]!.player.id;
  settle(room);
}

// an id no room has or had: a new room never takes over the page of an old one
async function freeId(): Promise<string> {
  for (;;) {
    const id = Array.from({ length: 6 }, () => ID_LETTERS[randomInt(ID_LETTERS.length)]).join("");
    const had = await db.select().from(t.matches).where(eq(t.matches.room, id)).limit(1);
    if (!had.length && !rooms.has(id)) return id;
  }
}

function sit(room: Room, session: Session, peer: Peer, spectating: boolean) {
  const seat: Seat = {
    player: session.player!,
    key: session.key!,
    room,
    peer,
    ready: false,
    level: room.chart?.level ?? "",
    mods: room.chart?.mods ?? 0,
    able: true,
    watching: spectating,
    follows: "",
    playing: false,
    score: 0,
    accuracy: 0,
    combo: 0,
    chatted: 0,
  };
  room.seats.push(seat);
  seated.set(seat.player.id, seat);
  push(room);
}

export const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
const hex = (bytes: number) => v.pipe(v.string(), v.regex(/^[0-9a-f]*$/), v.length(bytes * 2));
export const count = (max: number) =>
  v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(max));
export const Auth = v.object({ t: v.literal("auth"), key: hex(32), sig: hex(64) });
const Score = count(1_000_000);
const Notes = count(100_000);
const Accuracy = v.pipe(v.number(), v.minValue(0), v.maxValue(100));
export const Base64 = v.pipe(
  v.string(),
  v.regex(/^[A-Za-z0-9+/]*={0,2}$/),
  v.maxLength(MAX_MESSAGE),
);

const Message = v.variant("t", [
  Auth,
  v.object({ t: v.literal("create"), name: text(256), password: text(64) }),
  v.object({ t: v.literal("join"), room: text(16), password: text(64) }),
  v.object({ t: v.literal("leave") }),
  v.object({ t: v.literal("chart"), song: text(128), level: v.picklist(LEVELS), mods: v.number() }),
  v.object({ t: v.literal("queue"), song: text(128), level: v.picklist(LEVELS), mods: v.number() }),
  v.object({ t: v.literal("unqueue"), entry: count(1_000_000) }),
  v.object({ t: v.literal("move"), entry: count(1_000_000), to: count(ROOM_QUEUE) }),
  v.object({ t: v.literal("pick"), level: v.picklist(LEVELS), mods: v.number() }),
  v.object({ t: v.literal("ready"), ready: v.boolean() }),
  v.object({ t: v.literal("able"), able: v.boolean() }),
  v.object({ t: v.literal("start") }),
  v.object({ t: v.literal("score"), score: Score, accuracy: Accuracy, combo: Notes }),
  v.object({
    t: v.literal("result"),
    score: Score,
    accuracy: Accuracy,
    maxcombo: Notes,
    perfect: Notes,
    good: Notes,
    bad: Notes,
    miss: Notes,
  }),
  v.object({ t: v.literal("quit") }),
  v.object({ t: v.literal("chat"), text: text(1024) }),
  v.object({ t: v.literal("kick"), player: text(16) }),
  v.object({ t: v.literal("host"), player: text(16) }),
  v.object({ t: v.literal("rename"), name: text(256) }),
  v.object({ t: v.literal("watch"), room: text(16), password: text(64) }),
  v.object({ t: v.literal("spectate"), spectate: v.boolean() }),
  v.object({ t: v.literal("frames"), data: Base64 }),
  v.object({ t: v.literal("follow"), player: text(16), from: count(100_000) }),
]);
type Message = v.InferOutput<typeof Message>;

// the game proves it holds a profile's key, and gets back the room it was in if its connection dropped
async function auth(peer: Peer, session: Session, m: Extract<Message, { t: "auth" }>) {
  const who = await socketPlayer(DOMAIN, session.nonce, m);
  if (typeof who === "string") {
    log.warn("room.auth.refused", { code: who });
    return fail(peer, who);
  }
  const found = who.player;
  session.player = found;
  session.key = who.key;
  send(peer, { t: "welcome", player: found });
  const seat = seated.get(found.id);
  // a game that was in a room hears there whether it still is
  if (!seat) return send(peer, { t: "room", room: null });
  // the same player on another connection: the older one is told and loses its place
  if (seat.peer && seat.peer !== peer) fail(seat.peer, "elsewhere");
  clearTimeout(seat.away);
  seat.away = undefined;
  seat.peer = peer;
  seat.player = found;
  send(peer, { t: "room", room: view(seat.room) });
}

// a room's name, links taken out, or the player's when nothing is left
const nameOf = (typed: string, player: PlayerName) =>
  clean(typed.replace(URLS, " "), ROOM_NAME) || clean(player.name, ROOM_NAME);

// why a player wasn't let in a room or given what they asked of it
function refuse(peer: Peer, action: string, code: string, room?: Room, player?: string) {
  log.warn("room.refused", { action, code, room: room?.id, player });
  fail(peer, code);
}

async function create(peer: Peer, session: Session, m: Extract<Message, { t: "create" }>) {
  const id = await freeId();
  if (rooms.size >= MAX_ROOMS)
    return refuse(peer, "create", "rooms", undefined, session.player!.id);
  const current = seated.get(session.player!.id);
  if (current) leave(current);
  const room: Room = {
    id,
    name: nameOf(m.name, session.player!),
    password: m.password,
    host: session.player!.id,
    seats: [],
    banned: new Set(),
    chart: null,
    played: false,
    queue: [],
    entries: 0,
    last: null,
    playing: false,
    results: [],
    streams: new Map(),
    watchers: new Set(),
    guessed: 0,
    listed: "",
  };
  rooms.set(room.id, room);
  log.info("room.create", { room: id, player: room.host, locked: room.password !== "" });
  sit(room, session, peer, false);
}

// a room takes one guess a second from anyone, so its password can't be found by trying them all
function admits(room: Room, password: string) {
  if (!room.password) return true;
  const now = Date.now();
  if (password === room.password && now - room.guessed >= GUESS_PAUSE) return true;
  room.guessed = now;
  return false;
}

function join(peer: Peer, session: Session, m: Extract<Message, { t: "join" }>) {
  const id = session.player!.id;
  const room = rooms.get(m.room.toUpperCase());
  if (!room) return refuse(peer, "join", "gone", room, id);
  const current = seated.get(id);
  if (current?.room === room) return send(peer, { t: "room", room: view(room) });
  if (room.banned.has(id)) return refuse(peer, "join", "kicked", room, id);
  if (!admits(room, m.password)) return refuse(peer, "join", "password", room, id);
  // a room full of players still takes spectators
  const spectating = players(room) >= ROOM_PLAYERS;
  if (spectating && room.seats.length >= ROOM_PLAYERS + ROOM_SPECTATORS)
    return refuse(peer, "join", "full", room, id);
  if (current) leave(current);
  log.info("room.join", { room: room.id, player: id, spectating });
  sit(room, session, peer, spectating);
}

function unwatch(peer: Peer) {
  const watcher = watching.get(peer);
  if (!watcher) return;
  watching.delete(peer);
  watcher.room.watchers.delete(watcher);
  push(watcher.room);
}

function watch(peer: Peer, m: Extract<Message, { t: "watch" }>) {
  const room = rooms.get(m.room.toUpperCase());
  if (!room) return refuse(peer, "watch", "gone");
  if (!admits(room, m.password)) return refuse(peer, "watch", "password", room);
  if (room.watchers.size >= ROOM_WATCHERS) return refuse(peer, "watch", "full", room);
  unwatch(peer);
  const watcher = { peer, room, follows: "" };
  watching.set(peer, watcher);
  room.watchers.add(watcher);
  push(room);
}

// the frames the player streamed this match from the given part (a viewer back from a dropped connection has the
// ones before), then the next ones as they come
function follow(viewer: Seat | Watcher, { player, from }: { player: string; from: number }) {
  viewer.follows = player;
  for (const data of viewer.room.streams.get(player)?.chunks.slice(from) ?? [])
    send(viewer.peer, { t: "frames", player, data });
}

function start(room: Room, host: Seat) {
  const waits = (seat: Seat) => seat !== host && !seat.watching && seat.able && !seat.ready;
  // those who have the chart play, but one whose connection is down wouldn't hear of it
  const plays = (seat: Seat) => !seat.watching && seat.able && seat.peer !== undefined;
  if (!room.chart || room.seats.some(waits) || !room.seats.some(plays)) return;
  room.playing = true;
  room.results = [];
  room.streams.clear();
  for (const seat of room.seats) {
    seat.playing = plays(seat);
    seat.score = seat.accuracy = seat.combo = 0;
  }
  room.limit = setTimeout(() => {
    log.warn("room.match.timeout", { room: room.id });
    finish(room);
    push(room);
  }, MATCH_LIMIT);
  log.info("room.match.start", {
    room: room.id,
    player: host.player.id,
    ...played(room, room.chart),
  });
  // players hear of the match before the room: a game told it plays without having started knows it was restarted
  const started = JSON.stringify({ t: "start", seed: randomInt(1, 2 ** 32) });
  for (const seat of room.seats) if (seat.playing) seat.peer!.send(started);
  push(room);
}

// a chart as a player adds it to their room
function added(seat: Seat, m: { song: string; level: string; mods: number }): RoomChart {
  const id = clean(m.song, 128);
  seat.room.entries += 1;
  return {
    song: canonicalSongId(id.replace(/\.0$/, "")),
    id,
    level: m.level,
    mods: m.mods,
    entry: seat.room.entries,
    by: seat.player.id,
  };
}

// what a player in a room asks for
function act(seat: Seat, m: Message) {
  const room = seat.room;
  const host = room.host === seat.player.id;
  switch (m.t) {
    case "leave":
      return leave(seat);
    // from a game older than the queue, whose host picks the chart the room is on
    case "chart":
      if (!host || room.playing || !validMods(m.mods, 0)) return;
      turn(room, added(seat, m));
      return push(room);
    case "queue": {
      if (!validMods(m.mods, 0)) return;
      const charts = room.chart ? [room.chart, ...room.queue] : [];
      const full =
        room.queue.length >= ROOM_QUEUE ||
        charts.filter((chart) => chart.by === seat.player.id).length >= ROOM_QUEUE_EACH;
      // a chart already played leaves its place to the next one added
      if (room.chart && (room.playing || !room.played)) {
        if (full) return refuse(seat.peer!, "queue", "queue", room, seat.player.id);
        room.queue.push(added(seat, m));
      } else turn(room, added(seat, m));
      return push(room);
    }
    case "unqueue": {
      const taken = (chart: RoomChart) =>
        chart.entry === m.entry && (host || chart.by === seat.player.id);
      if (room.chart && taken(room.chart)) {
        if (room.playing) return;
        turn(room, room.queue.shift() ?? null);
      } else room.queue = room.queue.filter((chart) => !taken(chart));
      return push(room);
    }
    // the host puts a queued chart at another place of the queue
    case "move": {
      const at = room.queue.findIndex((chart) => chart.entry === m.entry);
      if (!host || at < 0) return;
      room.queue.splice(m.to, 0, ...room.queue.splice(at, 1));
      return push(room);
    }
    case "pick":
      if (room.playing || !validMods(m.mods, 0)) return;
      Object.assign(seat, { level: m.level, mods: m.mods, ready: false });
      return push(room);
    case "ready":
      if (room.playing || !seat.able || seat.watching) return;
      seat.ready = m.ready;
      return push(room);
    case "able":
      seat.able = m.able;
      seat.ready &&= m.able;
      return push(room);
    case "start":
      if (host && !room.playing) start(room, seat);
      return;
    case "score": {
      if (!seat.playing) return;
      Object.assign(seat, { score: m.score, accuracy: m.accuracy, combo: m.combo });
      room.pushing ??= setTimeout(() => push(room), SCORES_PUSH);
      return;
    }
    case "result": {
      if (!seat.playing) return;
      const { score, accuracy, maxcombo, perfect, good, bad, miss } = m;
      const { level, mods } = seat;
      const total = totalOf(score, mods);
      room.results.push({
        seat,
        result: { score, accuracy, maxcombo, perfect, good, bad, miss, level, mods, total },
      });
      Object.assign(seat, { playing: false, score, accuracy });
      return settle(room);
    }
    case "quit":
      if (!seat.playing) return;
      seat.playing = false;
      return settle(room);
    case "chat": {
      const line = clean(m.text, ROOM_CHAT);
      const now = Date.now();
      if (!line || now - seat.chatted < CHAT_PAUSE) return;
      seat.chatted = now;
      const told = JSON.stringify({ t: "chat", player: seat.player.id, text: line });
      for (const each of room.seats) each.peer?.send(told);
      return;
    }
    case "spectate": {
      if (seat.playing || seat.watching === m.spectate) return;
      const full = m.spectate
        ? room.seats.length - players(room) >= ROOM_SPECTATORS
        : players(room) >= ROOM_PLAYERS;
      if (full) return refuse(seat.peer!, "spectate", "full", room, seat.player.id);
      Object.assign(seat, { watching: m.spectate, ready: false, follows: "" });
      return push(room);
    }
    case "frames": {
      if (!seat.playing) return;
      const id = seat.player.id;
      const stream = room.streams.get(id) ?? { chunks: [], size: 0 };
      if (stream.size + m.data.length > STREAM) return;
      stream.chunks.push(m.data);
      stream.size += m.data.length;
      room.streams.set(id, stream);
      const told = JSON.stringify({ t: "frames", player: id, data: m.data });
      for (const each of [...room.seats, ...room.watchers])
        if (each.follows === id) each.peer?.send(told);
      return;
    }
    case "follow":
      if (seat.watching) follow(seat, m);
      return;
    case "rename":
      if (!host) return;
      room.name = nameOf(m.name, seat.player);
      return push(room);
    case "host":
    case "kick": {
      const target = room.seats.find((each) => each.player.id === m.player);
      if (!host || !target || target === seat) return;
      if (m.t === "host") {
        room.host = m.player;
        return push(room);
      }
      room.banned.add(m.player);
      log.info("room.kick", { room: room.id, player: seat.player.id, target: m.player });
      if (target.peer) fail(target.peer, "kicked");
      return leave(target);
    }
  }
}

/** Greets a socket with the nonce its game signs. */
export function greet(peer: Peer): string {
  const nonce = randomBytes(16).toString("hex");
  send(peer, { t: "hello", nonce });
  return nonce;
}

/** What a socket said as its schema reads it. One saying anything else is closed. */
export function heard<Schema extends v.GenericSchema>(peer: Peer, schema: Schema, raw: string) {
  try {
    if (raw.length > MAX_MESSAGE) throw new Error("too long");
    return v.parse(schema, JSON.parse(raw));
  } catch {
    // a game and a server that don't speak the same show here. what it said may hold a password: only its size is kept
    log.warn("socket.bad", {
      path: peer.request.url.replace(/^.*?\/api/, "/api"),
      size: raw.length,
    });
    peer.close(1003, "Not a message");
  }
}

export function open(peer: Peer) {
  sessions.set(peer, { nonce: greet(peer), turn: serial() });
}

export function message(peer: Peer, raw: string) {
  const session = sessions.get(peer);
  session
    ?.turn(() => {
      const m = heard(peer, Message, raw);
      if (!m) return;
      if (m.t === "auth") return auth(peer, session, m);
      // a browser that watches never signs in, and says nothing but who it follows
      if (m.t === "watch" && !session.player) return watch(peer, m);
      const watcher = watching.get(peer);
      if (watcher) return m.t === "follow" ? follow(watcher, m) : undefined;
      if (!session.player) return fail(peer, "auth");
      if (m.t === "create") return create(peer, session, m);
      if (m.t === "join") return join(peer, session, m);
      const seat = seated.get(session.player.id);
      if (seat?.peer === peer) act(seat, m);
    })
    .catch(failed(peer));
}

// a dropped connection keeps its place for a while: the game connects again and finds its room
export function closed(peer: Peer) {
  const session = sessions.get(peer);
  session
    ?.turn(() => {
      sessions.delete(peer);
      unwatch(peer);
      const seat = session.player && seated.get(session.player.id);
      if (!seat || seat.peer !== peer) return;
      seat.peer = undefined;
      seat.away = setTimeout(() => leave(seat), AWAY);
    })
    .catch(failed());
}

/** How many rooms are open, players seated, browsers watching and sockets connected, for /admin. */
export const gauges = () => ({
  rooms: rooms.size,
  seated: seated.size,
  watching: watching.size,
  sockets: sessions.size,
});

/** The room a player sits in, for an invitation to it (server/friends.ts). */
export const roomOf = (player: string) => seated.get(player)?.room;

/** The open rooms, the fullest first. */
export const openRooms = (): RoomSummary[] =>
  [...rooms.values()].map(summary).sort((a, b) => b.players - a.players);

/** A room and the matches it played, latest first, undefined when there's no such room and never was. */
export async function roomPage(id: string): Promise<RoomPage | undefined> {
  const room = rooms.get(id);
  const matches: Match[] = [];
  const standings = new Map<string, Standing>();
  let name = room?.name;
  const latest = db
    .select({ id: t.matches.id })
    .from(t.matches)
    .where(eq(t.matches.room, id))
    .orderBy(desc(t.matches.played), desc(t.matches.id))
    .limit(PAGE_MATCHES);
  const rows = await db
    .select({ of: t.matches, play: t.match_plays, who: NAME })
    .from(t.matches)
    .innerJoin(t.match_plays, eq(t.match_plays.match, t.matches.id))
    .innerJoin(t.players, eq(t.players.key, t.match_plays.key))
    .where(inArray(t.matches.id, latest))
    .orderBy(desc(t.matches.played), desc(t.matches.id), t.match_plays.place);
  for (const { of, play, who } of rows) {
    name ??= of.name;
    let match = matches.at(-1);
    if (match?.id !== of.id) {
      match = {
        id: of.id,
        song: of.song,
        level: of.level,
        mods: of.mods,
        date: of.played,
        plays: [],
      };
      matches.push(match);
    }
    const { score, accuracy, maxcombo, perfect, good, bad, miss, level, mods } = play;
    const total = totalOf(score, mods);
    const rank = match.plays.length + 1;
    match.plays.push({
      player: who,
      rank,
      total,
      level,
      mods,
      score,
      accuracy,
      maxcombo,
      perfect,
      good,
      bad,
      miss,
    });
    const standing = standings.get(who.id) ?? { player: who, wins: 0, matches: 0, total: 0 };
    standing.wins += rank === 1 ? 1 : 0;
    standing.matches += 1;
    standing.total += total;
    standings.set(who.id, standing);
  }
  if (name === undefined) return undefined;
  return {
    id,
    name,
    open: room ? summary(room) : null,
    room: room && !room.password ? view(room) : null,
    matches,
    standings: [...standings.values()].sort((a, b) => b.wins - a.wins || b.total - a.total),
  };
}
