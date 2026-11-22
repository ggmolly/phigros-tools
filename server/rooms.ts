import { randomBytes, randomInt } from "node:crypto";
import type { Peer } from "crossws";
import * as v from "valibot";
import { canonicalSongId, catalogSong } from "../src/catalog";
import { totalOf, validMods } from "../src/modifiers";
import { LEVELS } from "../src/modules";
import type { PlayerName } from "../src/plays";
import {
  type Match,
  ROOM_CHAT,
  ROOM_NAME,
  ROOM_PLAYERS,
  type RoomChart,
  type RoomPage,
  type RoomResult,
  type RoomSummary,
  type RoomView,
  type Standing,
} from "../src/rooms";
import { topics } from "../src/topics";
import { deviceOf, verifySignature } from "./auth";
import { sqlite } from "./db";
import { clean, markSeen, player } from "./players";
import { announce } from "./queue";

/*
 * Multiplayer rooms. Phigros++ keeps one WebSocket open (routes/api/room.ts) and talks in JSON objects named by `t`.
 * The server greets with a nonce ({ t: "hello", nonce }) that the game signs with its profile's key ({ t: "auth", key,
 * sig }, both hex), then the player makes or joins a room. Every change of a room goes to its players whole
 * ({ t: "room", room }, null once they're out of it), a refusal is { t: "error", code }.
 *
 * In a room, its host picks the chart and its modifiers, the others say when they're ready and whether their game has
 * the chart, and the host starts once everyone who has it is ready ({ t: "start", seed } to those who play). Players
 * send their score as they play, which the room hears about once a second, and their result at the end: the match is
 * over when nobody plays any more. Chat lines go to the room's players and nowhere else.
 *
 * Rooms live in memory, the matches of those without a password are kept: the site shows both (src/rooms.ts).
 */

sqlite.run(`
  CREATE TABLE IF NOT EXISTS matches (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    room TEXT NOT NULL,
    name TEXT NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    mods INTEGER NOT NULL,
    played INTEGER NOT NULL
  )
`);
sqlite.run("CREATE INDEX IF NOT EXISTS idx_matches_room ON matches(room, id DESC)");
// inserted best first, so plays that tie keep the order they finished in
sqlite.run(`
  CREATE TABLE IF NOT EXISTS match_plays (
    match INTEGER NOT NULL,
    key BLOB NOT NULL,
    score INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    maxcombo INTEGER NOT NULL,
    perfect INTEGER NOT NULL,
    good INTEGER NOT NULL,
    bad INTEGER NOT NULL,
    miss INTEGER NOT NULL,
    PRIMARY KEY (match, key)
  )
`);

const DOMAIN = "phigros.tools rooms v1\0"; // the key signs requests and replays too
const MAX_ROOMS = 500;
const MAX_MESSAGE = 4096;
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
  able: boolean;
  playing: boolean;
  score: number;
  accuracy: number;
  combo: number;
  chatted: number;
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
  chart: RoomChart | null;
  last: Match | null;
  playing: boolean;
  /** The match being played: its results as they come, and what ends it when it takes too long. */
  results: { seat: Seat; result: RoomResult }[];
  limit?: Timer;
  /** A push to the site that waits, and the summary the list last heard. */
  pushing?: Timer;
  listed: string;
}

interface Session {
  nonce: string;
  player?: PlayerName;
  key?: Uint8Array;
}

const rooms = new Map<string, Room>();
const seated = new Map<string, Seat>(); // by player id: a player sits in one room
const sessions = new Map<Peer, Session>();

const send = (peer: Peer | undefined, message: object) => peer?.send(JSON.stringify(message));
const fail = (peer: Peer, code: string) => send(peer, { t: "error", code });

function view(room: Room): RoomView {
  return {
    id: room.id,
    name: room.name,
    locked: room.password !== "",
    host: room.host,
    playing: room.playing,
    chart: room.chart,
    players: room.seats.map((seat) => ({
      player: seat.player,
      ready: seat.ready,
      able: seat.able,
      playing: seat.playing,
      score: seat.score,
      accuracy: seat.accuracy,
      combo: seat.combo,
    })),
    last: room.last,
  };
}

function summary(room: Room): RoomSummary {
  const locked = room.password !== "";
  return {
    id: room.id,
    name: room.name,
    locked,
    playing: room.playing,
    players: room.seats.length,
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
  for (const seat of room.seats) seat.peer?.send(text);
  publish(room);
}

const insertMatch = sqlite.prepare<
  { id: number },
  [string, string, string, string, number, number]
>(
  "INSERT INTO matches (room, name, song, level, mods, played) VALUES (?, ?, ?, ?, ?, ?) RETURNING id",
);
const insertPlay = sqlite.prepare<
  unknown,
  [number, Uint8Array, number, number, number, number, number, number, number]
>(
  `INSERT INTO match_plays (match, key, score, accuracy, maxcombo, perfect, good, bad, miss)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
);

// the match is over: its plays are ranked, and kept when the room has no password and the site knows the chart
function finish(room: Room) {
  clearTimeout(room.limit);
  room.playing = false;
  for (const seat of room.seats) seat.ready = seat.playing = false;
  const results = room.results.sort(
    (a, b) => b.result.score - a.result.score || b.result.accuracy - a.result.accuracy,
  );
  room.results = [];
  const chart = room.chart!;
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
      total: totalOf(result.score, chart.mods),
    })),
  };
  room.last = match;
  if (room.password || !catalogSong(chart.song)) return;
  sqlite.transaction(() => {
    match.id = insertMatch.get(
      room.id,
      room.name,
      match.song,
      match.level,
      match.mods,
      match.date,
    )!.id;
    for (const { seat, result: r } of results)
      insertPlay.run(
        match.id,
        seat.key,
        r.score,
        r.accuracy,
        r.maxcombo,
        r.perfect,
        r.good,
        r.bad,
        r.miss,
      );
  })();
  void announce(topics.room(room.id));
}

function close(room: Room) {
  clearTimeout(room.limit);
  clearTimeout(room.pushing);
  rooms.delete(room.id);
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

const matchOf = sqlite.prepare<{ id: number }, [string]>(
  "SELECT id FROM matches WHERE room = ? LIMIT 1",
);

// an id no room has or had: a new room never takes over the page of an old one
function freeId(): string {
  for (;;) {
    const id = Array.from({ length: 6 }, () => ID_LETTERS[randomInt(ID_LETTERS.length)]).join("");
    if (!rooms.has(id) && !matchOf.get(id)) return id;
  }
}

function sit(room: Room, session: Session, peer: Peer) {
  const seat: Seat = {
    player: session.player!,
    key: session.key!,
    room,
    peer,
    ready: false,
    able: true,
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

const text = (max: number) => v.pipe(v.string(), v.maxLength(max));
const hex = (bytes: number) => v.pipe(v.string(), v.regex(/^[0-9a-f]*$/), v.length(bytes * 2));
const count = (max: number) => v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(max));
const Score = count(1_000_000);
const Notes = count(100_000);
const Accuracy = v.pipe(v.number(), v.minValue(0), v.maxValue(100));

const Message = v.variant("t", [
  v.object({ t: v.literal("auth"), key: hex(32), sig: hex(64) }),
  v.object({ t: v.literal("create"), name: text(256), password: text(64) }),
  v.object({ t: v.literal("join"), room: text(16), password: text(64) }),
  v.object({ t: v.literal("leave") }),
  v.object({ t: v.literal("chart"), song: text(128), level: v.picklist(LEVELS), mods: v.number() }),
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
]);
type Message = v.InferOutput<typeof Message>;

// the game proves it holds a profile's key, and gets back the room it was in if its connection dropped
function auth(peer: Peer, session: Session, m: Extract<Message, { t: "auth" }>) {
  const key = Buffer.from(m.key, "hex");
  if (!verifySignature(key, Buffer.from(DOMAIN + session.nonce), Buffer.from(m.sig, "hex")))
    return fail(peer, "auth");
  const device = deviceOf.get(key);
  const owner = device?.owner ?? key;
  const found = !device?.removed && player(owner);
  if (!found) return fail(peer, "no-profile");
  markSeen(owner);
  session.player = found;
  session.key = owner;
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

function create(peer: Peer, session: Session, m: Extract<Message, { t: "create" }>) {
  if (rooms.size >= MAX_ROOMS) return fail(peer, "rooms");
  const current = seated.get(session.player!.id);
  if (current) leave(current);
  const name =
    clean(m.name.replace(URLS, " "), ROOM_NAME) || clean(session.player!.name, ROOM_NAME);
  const room: Room = {
    id: freeId(),
    name,
    password: m.password,
    host: session.player!.id,
    seats: [],
    banned: new Set(),
    chart: null,
    last: null,
    playing: false,
    results: [],
    listed: "",
  };
  rooms.set(room.id, room);
  sit(room, session, peer);
}

function join(peer: Peer, session: Session, m: Extract<Message, { t: "join" }>) {
  const id = session.player!.id;
  const room = rooms.get(m.room.toUpperCase());
  if (!room) return fail(peer, "gone");
  const current = seated.get(id);
  if (current?.room === room) return send(peer, { t: "room", room: view(room) });
  if (room.banned.has(id)) return fail(peer, "kicked");
  if (room.password && m.password !== room.password) return fail(peer, "password");
  if (room.seats.length >= ROOM_PLAYERS) return fail(peer, "full");
  if (current) leave(current);
  sit(room, session, peer);
}

function start(room: Room, host: Seat) {
  if (!room.chart || room.seats.some((seat) => seat !== host && seat.able && !seat.ready)) return;
  room.playing = true;
  room.results = [];
  // those who have the chart play, but one whose connection is down wouldn't hear of it
  for (const seat of room.seats) {
    seat.playing = (seat === host || seat.able) && seat.peer !== undefined;
    seat.score = seat.accuracy = seat.combo = 0;
  }
  room.limit = setTimeout(() => {
    finish(room);
    push(room);
  }, MATCH_LIMIT);
  push(room);
  const started = JSON.stringify({ t: "start", seed: randomInt(1, 2 ** 32) });
  for (const seat of room.seats) if (seat.playing) seat.peer!.send(started);
}

// what a player in a room asks for
function act(seat: Seat, m: Message) {
  const room = seat.room;
  const host = room.host === seat.player.id;
  switch (m.t) {
    case "leave":
      return leave(seat);
    case "chart": {
      if (!host || room.playing || !validMods(m.mods, 0)) return;
      const id = clean(m.song, 128);
      const same = room.chart?.id === id && room.chart.level === m.level;
      room.chart = {
        song: canonicalSongId(id.replace(/\.0$/, "")),
        id,
        level: m.level,
        mods: m.mods,
      };
      // every game says again whether it has a new chart
      for (const each of room.seats) {
        each.ready = false;
        each.able ||= !same;
      }
      return push(room);
    }
    case "ready":
      if (room.playing || !seat.able) return;
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
      room.results.push({ seat, result: { score, accuracy, maxcombo, perfect, good, bad, miss } });
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
    case "kick": {
      const target = room.seats.find((each) => each.player.id === m.player);
      if (!host || !target || target === seat) return;
      room.banned.add(m.player);
      if (target.peer) fail(target.peer, "kicked");
      return leave(target);
    }
  }
}

export function open(peer: Peer) {
  const nonce = randomBytes(16).toString("hex");
  sessions.set(peer, { nonce });
  send(peer, { t: "hello", nonce });
}

export function message(peer: Peer, raw: string) {
  const session = sessions.get(peer);
  if (!session) return;
  let m: Message;
  try {
    if (raw.length > MAX_MESSAGE) throw new Error("too long");
    m = v.parse(Message, JSON.parse(raw));
  } catch {
    return peer.close(1003, "Not a room message");
  }
  if (m.t === "auth") return auth(peer, session, m);
  if (!session.player) return fail(peer, "auth");
  if (m.t === "create") return create(peer, session, m);
  if (m.t === "join") return join(peer, session, m);
  const seat = seated.get(session.player.id);
  if (seat?.peer === peer) act(seat, m);
}

// a dropped connection keeps its place for a while: the game connects again and finds its room
export function closed(peer: Peer) {
  const session = sessions.get(peer);
  sessions.delete(peer);
  const seat = session?.player && seated.get(session.player.id);
  if (!seat || seat.peer !== peer) return;
  seat.peer = undefined;
  seat.away = setTimeout(() => leave(seat), AWAY);
}

/** The open rooms, the fullest first. */
export const openRooms = (): RoomSummary[] =>
  [...rooms.values()].map(summary).sort((a, b) => b.players - a.players);

const played = sqlite.prepare<
  {
    match: number;
    name: string;
    song: string;
    level: string;
    mods: number;
    played: number;
    id: string;
    player: string;
    number: number;
    avatar: string;
  } & RoomResult,
  [string, number]
>(
  `SELECT m.id AS match, m.name, m.song, m.level, m.mods, m.played, p.id, p.name AS player, p.number, p.avatar,
     mp.score, mp.accuracy, mp.maxcombo, mp.perfect, mp.good, mp.bad, mp.miss
   FROM matches m JOIN match_plays mp ON mp.match = m.id JOIN players p ON p.key = mp.key
   WHERE m.id IN (SELECT id FROM matches WHERE room = ?1 ORDER BY id DESC LIMIT ?2)
   ORDER BY m.id DESC, mp.score DESC, mp.accuracy DESC, mp.rowid`,
);

/** A room and the matches it played, latest first, undefined when there's no such room and never was. */
export function roomPage(id: string): RoomPage | undefined {
  const room = rooms.get(id);
  const matches: Match[] = [];
  const standings = new Map<string, Standing>();
  let name = room?.name;
  for (const row of played.all(id, PAGE_MATCHES)) {
    name ??= row.name;
    let match = matches.at(-1);
    if (match?.id !== row.match) {
      match = {
        id: row.match,
        song: row.song,
        level: row.level,
        mods: row.mods,
        date: row.played,
        plays: [],
      };
      matches.push(match);
    }
    const { score, accuracy, maxcombo, perfect, good, bad, miss } = row;
    const who = { id: row.id, name: row.player, number: row.number, avatar: row.avatar };
    const total = totalOf(score, row.mods);
    const rank = match.plays.length + 1;
    match.plays.push({
      player: who,
      rank,
      total,
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
