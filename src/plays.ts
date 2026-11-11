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

/** A player's page, from `GET /api/players/<id>`. */
export interface PlayerProfile {
  player: PlayerName;
  intro: string;
  background: string;
  rks: number;
  unlisted: boolean;
  /** When their save was uploaded, in ms, null when it wasn't. */
  save: number | null;
  /** Each chart's best, highest score first. */
  bests: {
    song: string;
    level: string;
    score: number;
    accuracy: number;
    fc: boolean;
    status: PlayStatus;
    date: number | null;
    replay: string | null;
  }[];
}

export const PLAYS_PAGE = 50;
