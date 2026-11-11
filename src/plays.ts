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
  rks: number;
  /** Among listed players by RKS, null while unlisted or without RKS. */
  rank: number | null;
  /** When they joined and were last seen, in ms. */
  joined: number;
  seen: number;
  stats: {
    plays: number;
    /** Seconds spent playing. */
    time: number;
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
