import { createServerFn } from "@tanstack/react-start";
import { serverFetch } from "nitro/app";
import accents from "./accents.json";
import type { PlayerName } from "./plays";

/**
 * Multiplayer rooms of Phigros++ (server/rooms.ts): players of a room play the chart its host picks at the same time.
 * `GET /api/rooms` lists the open ones, `GET /api/rooms/<id>` is a room with the matches it played.
 */

/** What a room's name, players and chat messages are held to. */
export const ROOM_NAME = 24;
export const ROOM_PLAYERS = 8;
export const ROOM_CHAT = 200;

/** The chart a room plays next: the catalog's song id, the game's own (`id`), and the modifiers' bits. */
export interface RoomChart {
  song: string;
  id: string;
  level: string;
  mods: number;
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

/** A play's place in its match, by score then accuracy, and the total its modifiers give the score. */
export interface MatchPlay extends RoomResult {
  player: PlayerName;
  rank: number;
  total: number;
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
  /** Whether their game has the room's chart unlocked: one who doesn't sits the match out. */
  able: boolean;
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
  chart: RoomChart | null;
  players: RoomPlayer[];
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
