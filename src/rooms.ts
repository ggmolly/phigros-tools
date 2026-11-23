import { createServerFn } from "@tanstack/react-start";
import { serverFetch } from "nitro/app";
import accents from "./accents.json";
import type { PlayerName } from "./plays";

/**
 * Multiplayer rooms of Phigros++ (server/rooms.ts): players of a room play the chart its host picks at the same time.
 * `GET /api/rooms` lists the open ones, `GET /api/rooms/<id>` is a room with the matches it played.
 */

/** What a room's name, players, queue and chat messages are held to. */
export const ROOM_NAME = 24;
/** The charts a room queues after the one it's on, and how many of a room's charts may be one player's. */
export const ROOM_QUEUE = 20;
export const ROOM_QUEUE_EACH = 3;
export const ROOM_PLAYERS = 8;
/** How many may spectate a room from their game, and watch it from a browser. */
export const ROOM_SPECTATORS = 8;
export const ROOM_WATCHERS = 64;
export const ROOM_CHAT = 200;

/**
 * A chart a room plays: the catalog's song id, the game's own (`id`), and the level and modifiers (their bits) it was
 * added with, which each player plays it with until they pick their own. `entry` tells the room's charts apart, `by`
 * is the id of the player who added it.
 */
export interface RoomChart {
  song: string;
  id: string;
  level: string;
  mods: number;
  entry: number;
  by: string;
}

/** What a play gave once its song ended. */
export interface RoomResult {
  score: number;
  accuracy: number;
  maxcombo: number;
  perfect: number;
  good: number;
  bad: number;
  miss: number;
}

/**
 * A play's place in its match, by the total its modifiers give the score then by accuracy, and the level and
 * modifiers its player picked.
 */
export interface MatchPlay extends RoomResult {
  player: PlayerName;
  rank: number;
  total: number;
  level: string;
  mods: number;
}

/** A chart a room played, with every player who finished it, best first. */
export interface Match {
  id: number;
  song: string;
  level: string;
  mods: number;
  /** When it ended, in ms. */
  date: number;
  plays: MatchPlay[];
}

export interface RoomPlayer {
  player: PlayerName;
  ready: boolean;
  /** The level and modifiers they play the room's chart with. */
  level: string;
  mods: number;
  /** Whether their game has the room's chart unlocked at that level: one who doesn't sits the match out. */
  able: boolean;
  /** Spectating: they don't play, nor count among the room's players. */
  watching: boolean;
  /** In the match being played, with their score so far. */
  playing: boolean;
  score: number;
  accuracy: number;
  combo: number;
}

/** A room as its players see it, and the site when it has no password. */
export interface RoomView {
  id: string;
  name: string;
  locked: boolean;
  /** The id of the player who picks the chart and starts. */
  host: string;
  playing: boolean;
  /** The chart it's on, and the ones its players queued after it. */
  chart: RoomChart | null;
  queue: RoomChart[];
  players: RoomPlayer[];
  /** How many browsers watch it. */
  watchers: number;
  /** The match it played last, null before any. */
  last: Match | null;
}

/** An open room in the list. One with a password says nothing of what it plays. */
export interface RoomSummary {
  id: string;
  name: string;
  locked: boolean;
  playing: boolean;
  players: number;
  chart: RoomChart | null;
}

/** A player's results over a room's matches. */
export interface Standing {
  player: PlayerName;
  wins: number;
  matches: number;
  total: number;
}

/** A room's page: `open` while players are in it, `room` when it has no password, and the matches it played. */
export interface RoomPage {
  id: string;
  name: string;
  open: RoomSummary | null;
  room: RoomView | null;
  matches: Match[];
  standings: Standing[];
}

/** The link that opens Phigros++ in a room. */
export const roomLink = (id: string) => `phigrospp://room/${id}`;

async function api<T>(path: string): Promise<T | null> {
  const response = await serverFetch(path);
  return response.ok ? response.json() : null;
}

export const getRooms = createServerFn({ method: "GET" }).handler(
  async () => (await api<RoomSummary[]>("/api/rooms")) ?? [],
);

/** A room with the colour of the song it plays or played last, null for an unknown id. */
export const getRoom = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const page = await api<RoomPage>(`/api/rooms/${encodeURIComponent(id)}`);
    const song = page?.room?.chart?.song ?? page?.matches[0]?.song;
    return page && { ...page, themeColor: song && (accents as Record<string, string>)[song] };
  });
