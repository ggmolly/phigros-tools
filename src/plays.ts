import { createServerFn } from "@tanstack/react-start";
import { serverFetch } from "nitro/app";
import accents from "./accents.json";
/** The leaderboard, from players' uploaded bests: `GET /api/players`, `GET /api/charts` and `GET /api/charts/<id>/<level>`. */

/** A player as the site shows them: their avatar and name#number, and the id their page is at. */
export interface PlayerName {
  id: string;
  name: string;
  number: number;
  /** The game's avatar key, "" for its default. */
  avatar: string;
}

/** What counts on the leaderboard: a verified replay, or a record the player's game declared, with no replay. */
export type PlayStatus = "verified" | "imported";

/** A player's best on a chart: an uploaded replay, or an imported record. */
export interface Play {
  id: string;
  rank: number;
  player: PlayerName;
  score: number;
  accuracy: number;
  fc: boolean;
  status: PlayStatus;
  /** When it was played, in ms, null for an imported record. */
  date: number | null;
  /** The replay to watch, null for an imported record. */
  replay: string | null;
}

/** Who played a replay and what they got, from `GET /api/replays/<id>/info`. */
export interface ReplayInfo {
  player: PlayerName;
  song: string;
  level: string;
  status: "pending" | "verified" | "unverified";
  /** When it was played, in ms. */
  date: number;
  score: number;
  accuracy: number;
  fc: boolean;
  maxcombo: number;
  perfect: number;
  good: number;
  bad: number;
  miss: number;
  /** The Phigros++ version it was played with, and the files the player added to its mods/ and core/ folders. */
  phigrospp: string;
  files: string[];
}

/** How many players a chart has and the best ones. */
export interface ChartPlays {
  count: number;
  plays: Play[];
}

/** A player's place by RKS. */
export interface PlayerRank {
  rank: number;
  player: PlayerName;
  rks: number;
}

export interface PlayerRanking {
  count: number;
  players: PlayerRank[];
}

/** A chart with uploaded plays, by the catalog's song id. */
export interface ChartCount {
  song: string;
  level: string;
  count: number;
}

/** A chart a player played, as their page lists it. */
export interface PlayedChart {
  song: string;
  level: string;
  score: number;
  accuracy: number;
  fc: boolean;
  /** When it was played, in ms, null for an imported record. */
  date: number | null;
  /** The verified replay to watch, if there's one. */
  replay: string | null;
}

/** A player's page, from `GET /api/players/<id>`: their profile, stats and plays, like an osu! profile. */
/** Some of a list, and whether more follow. */
export interface Page<T> {
  items: T[];
  more: boolean;
}

/** The rank a player's new best took on a chart. */
export interface Activity {
  song: string;
  level: string;
  score: number;
  rank: number;
  date: number;
}

/** A profile's lists show this many first, then this many more each time. */
export const LIST_FIRST = 12;
export const LIST_MORE = 30;

export interface PlayerProfile {
  player: PlayerName;
  intro: string;
  /** The illustration they show in Phigros, a song id ("Introduction" by default, empty when not shared). */
  background: string;
  rks: number;
  /** Among listed players by RKS, null while unlisted or without RKS. */
  rank: number | null;
  /** When they joined and were last seen, in ms. */
  joined: number;
  seen: number;
  stats: {
    plays: number;
    /** Perfects, goods and bads. */
    notes: number;
    /** The average accuracy of their plays, null before any. */
    accuracy: number | null;
    maxcombo: number;
    cleared: number;
    fc: number;
    phi: number;
  };
  /** Every best by its chart RKS, saying which count towards their RKS (best 27, then the 3 best Phi). */
  top: (PlayedChart & { status: PlayStatus; rks: number; counted: boolean })[];
  recent: Page<PlayedChart>;
  activity: Page<Activity>;
  /** Their RKS and rank once a day, oldest first. */
  history: { day: string; rks: number; rank: number }[];
}

export const PLAYS_PAGE = 50;

/** The sizes of the link preview images of players and replays (server/card.tsx). */
export const CARDS = { player: { width: 1600, height: 900 }, replay: { width: 1200, height: 630 } };

// the API read inside the server, during the server render too, so link previews show what the page does
async function api<T>(path: string): Promise<T | null> {
  const response = await serverFetch(path);
  return response.ok ? response.json() : null;
}

// a song's cover colour (scripts/build-accents.ts), the stripe of its link previews like on the chart pages
const accentOf = (song: string | undefined): string | undefined =>
  song && (accents as Record<string, string>)[song];

/** A player's page with the colour of their illustration, else of their top chart, null for an unknown id. */
export const getProfile = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const profile = await api<PlayerProfile>(`/api/players/${encodeURIComponent(id)}`);
    return (
      profile && {
        ...profile,
        themeColor: accentOf(profile.background) ?? accentOf(profile.top[0]?.song),
      }
    );
  });

/** Who played a replay with the colour of its song, null for an unknown one. */
export const getReplayInfo = createServerFn({ method: "GET" })
  .validator((id: string) => id)
  .handler(async ({ data: id }) => {
    const info = await api<ReplayInfo>(`/api/replays/${encodeURIComponent(id)}/info`);
    return info && { ...info, themeColor: accentOf(info.song) };
  });

// a ranking always answers, nothing back is the server failing. q searches the players
async function ranking<T>(path: string, page: number, verified: boolean, q = ""): Promise<T> {
  const query = new URLSearchParams({ page: String(page), q });
  if (verified) query.set("verified", "1");
  const data = await api<T>(`${path}?${query}`);
  if (!data) throw new Error(`${path} failed`);
  return data;
}

/** One page of the players by RKS, searched by name or name#0042. */
export const getPlayerRanking = createServerFn({ method: "GET" })
  .validator((search: { page: number; q: string; verified: boolean }) => search)
  .handler(({ data }) => ranking<PlayerRanking>("/api/players", data.page, data.verified, data.q));

/** Every chart with plays, most players first. */
export const getChartCounts = createServerFn({ method: "GET" })
  .validator((verified: boolean) => verified)
  .handler(({ data }) => ranking<ChartCount[]>("/api/charts", 1, data));

/** One page of a chart's players. */
export const getChartPlays = createServerFn({ method: "GET" })
  .validator((search: { song: string; level: string; page: number; verified: boolean }) => search)
  .handler(({ data }) =>
    ranking<ChartPlays>(
      `/api/charts/${encodeURIComponent(data.song)}/${encodeURIComponent(data.level)}`,
      data.page,
      data.verified,
    ),
  );
