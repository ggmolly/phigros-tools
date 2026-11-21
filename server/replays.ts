import { mkdirSync } from "node:fs";
import { calculateRanking } from "../src/metrics";
import { totalOf } from "../src/modifiers";
import { LEVELS, type LevelName, type SongRecord } from "../src/modules";
import type { ReplayHeader } from "../src/pigeon";
import type {
  Board,
  ChartCount,
  ChartPlays,
  PlayerName,
  PlayerRanking,
  PlayStatus,
  ReplayInfo,
} from "../src/plays";
import { sqlite } from "./db";
import { fold, setRks } from "./players";

export const REPLAY_DIR = "./data/replays";
mkdirSync(REPLAY_DIR, { recursive: true });

// song is the catalog's id, status is pending until the re-simulation verifies the result or finds it unverified
sqlite.run(`
  CREATE TABLE IF NOT EXISTS replays (
    sha256 TEXT PRIMARY KEY,
    key BLOB NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    score INTEGER NOT NULL,
    game INTEGER NOT NULL,
    header TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    result TEXT,
    created INTEGER NOT NULL
  )
`);
// added after the table: the timing accuracy of its touches (timingAccuracy), and the modifiers it was played with
const columns = sqlite.query<{ name: string }, []>("PRAGMA table_info(replays)").all();
for (const [name, type] of [
  ["timing", "REAL"],
  ["mods", "INTEGER NOT NULL DEFAULT 0"],
])
  if (!columns.some((c) => c.name === name))
    sqlite.run(`ALTER TABLE replays ADD COLUMN ${name} ${type}`);
sqlite.run("CREATE INDEX IF NOT EXISTS idx_replays_key ON replays(key)");
// each player's best on each chart, so a chart's ranking is read in order from the index: a verified replay (sha256),
// or a record their game sent (imported, no sha256, no date). a tie goes to the earliest played replay, then to
// the earliest record (created is when it became the best). the scope is what a leaderboard counts: 0 for all
// (both), 1 for verified replays only
sqlite.run(`
  CREATE TABLE IF NOT EXISTS bests (
    key BLOB NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    scope INTEGER NOT NULL,
    score INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    fc INTEGER NOT NULL,
    played INTEGER,
    created INTEGER NOT NULL,
    sha256 TEXT,
    PRIMARY KEY (key, song, level, scope)
  )
`);
// the records a player typed on the site to rebuild their save (see declareRecords): each sits above their best on
// its chart and counts nowhere, until a play from the game reaches it. kept here as the worker raises bests too
sqlite.run(`
  CREATE TABLE IF NOT EXISTS declared (
    key BLOB NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    score INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    fc INTEGER NOT NULL,
    PRIMARY KEY (key, song, level)
  )
`);
// each player's best with each set of modifiers on each chart (src/modifiers.ts), all verified replays: the board of
// plays with modifiers, apart from the bests as those are no records of the game's. score is the total the modifiers
// give it, which the board is ranked by
sqlite.run(`
  CREATE TABLE IF NOT EXISTS modded (
    key BLOB NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    mods INTEGER NOT NULL,
    score INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    fc INTEGER NOT NULL,
    played INTEGER NOT NULL,
    created INTEGER NOT NULL,
    sha256 TEXT NOT NULL,
    PRIMARY KEY (key, song, level, mods)
  )
`);
sqlite.run(
  "CREATE INDEX IF NOT EXISTS idx_modded_order ON modded(song, level, score DESC, played, created)",
);
sqlite.run("DROP INDEX IF EXISTS idx_bests_rank");
sqlite.run(
  "CREATE INDEX IF NOT EXISTS idx_bests_order ON bests(scope, song, level, score DESC, played IS NULL, played, created)",
);

/** What a leaderboard counts: all (verified replays and imported records), or verified replays only. */
export type Scope = 0 | 1;
const insert = sqlite.prepare<
  unknown,
  [string, Uint8Array, string, string, number, number, string, number, number]
>(
  `INSERT INTO replays (sha256, key, song, level, score, game, header, created, mods)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (sha256) DO NOTHING`,
);
const declaredScore = sqlite.prepare<{ score: number }, [Uint8Array, string, string]>(
  "SELECT score FROM declared WHERE key = ? AND song = ? AND level = ?",
);
const undeclare = sqlite.prepare<unknown, [Uint8Array, string, string, number]>(
  "DELETE FROM declared WHERE key = ? AND song = ? AND level = ? AND score <= ?",
);
// a higher score replaces the best, and so does a replay of the score an imported record has
const raise = sqlite.prepare<
  unknown,
  [Uint8Array, string, string, Scope, number, number, number, number | null, number, string | null]
>(
  `INSERT INTO bests (key, song, level, scope, score, accuracy, fc, played, created, sha256)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (key, song, level, scope) DO UPDATE SET score = excluded.score, accuracy = excluded.accuracy,
   fc = excluded.fc, played = excluded.played, sha256 = excluded.sha256,
   created = CASE WHEN excluded.score > bests.score THEN excluded.created ELSE bests.created END
   WHERE excluded.score > bests.score
     OR (excluded.score = bests.score AND bests.sha256 IS NULL AND excluded.sha256 IS NOT NULL)`,
);

// with modifiers, a higher total replaces the best with the same ones
const raiseModded = sqlite.prepare<
  unknown,
  [Uint8Array, string, string, number, number, number, number, number, number, string]
>(
  `INSERT INTO modded (key, song, level, mods, score, accuracy, fc, played, created, sha256)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (key, song, level, mods) DO UPDATE SET score = excluded.score, accuracy = excluded.accuracy,
   fc = excluded.fc, played = excluded.played, sha256 = excluded.sha256, created = excluded.created
   WHERE excluded.score > modded.score`,
);

export interface Best {
  score: number;
  accuracy: number;
  fc: boolean;
  /** When it was played, in ms, null for an imported record. */
  played: number | null;
  /** The replay proving it, null for an imported record. */
  sha256: string | null;
}

/**
 * A record counts for all, a verified replay for both scopes. Whether it became the player's best counting all. A
 * record no higher than the one the player declared is their rebuilt save sent back by the game, and counts for
 * nothing; anything reaching the declared score takes its place.
 */
export function raiseBest(key: Uint8Array, song: string, level: string, best: Best) {
  const { score, accuracy, fc, played, sha256 } = best;
  if (!sha256 && (declaredScore.get(key, song, level)?.score ?? -1) >= score) return false;
  undeclare.run(key, song, level, score);
  const now = Date.now();
  const raised =
    raise.run(key, song, level, 0, score, accuracy, fc ? 1 : 0, played, now, sha256).changes > 0;
  if (sha256) raise.run(key, song, level, 1, score, accuracy, fc ? 1 : 0, played, now, sha256);
  return raised;
}
const playerBests = sqlite.prepare<
  { song: string; level: LevelName; score: number; accuracy: number },
  [Uint8Array, Scope]
>("SELECT song, level, score, accuracy FROM bests WHERE key = ? AND scope = ?");

/** A player's RKS from their bests in a scope, counted like the game: best 27 plus the 3 best Phi charts. */
function rksOf(key: Uint8Array, scope: Scope) {
  const songs = new Map<string, Pick<SongRecord, "songId" | "fc" | "levels">>();
  for (const best of playerBests.all(key, scope)) {
    const song = songs.get(best.song) ?? {
      songId: best.song,
      fc: 0,
      levels: [null, null, null, null],
    };
    song.levels[LEVELS.indexOf(best.level)] = best;
    songs.set(best.song, song);
  }
  return calculateRanking({ songs: [...songs.values()] }, "b30").rankingScore;
}

export function updateRks(key: Uint8Array) {
  setRks(key, rksOf(key, 0), rksOf(key, 1));
}

/** Keeps an uploaded replay, pending until the worker judged it (server/worker.ts). */
export function addReplay(sha256: string, key: Uint8Array, song: string, header: ReplayHeader) {
  const json = JSON.stringify(header);
  const { difficulty, score, game, mods } = header;
  insert.run(sha256, key, song, difficulty, score, game, json, Date.now(), mods);
}

const verified = sqlite.prepare<{ key: Uint8Array; song: string; level: string }, [string]>(
  "SELECT key, song, level FROM replays WHERE sha256 = ?",
);

/**
 * A replay the worker verified counts: it can become its player's best on the chart, and their RKS follows. The
 * player and chart, and whether it became their best. One played with modifiers only counts on their board, as the
 * player's best with those: it's no record of the game's, so it raises nothing else.
 */
export function countReplay(sha256: string, header: ReplayHeader) {
  const { key, song, level } = verified.get(sha256)!;
  const { score, accuracy, mods } = header;
  const fc = header.bad + header.miss === 0;
  const played = header.date * 1000;
  return sqlite.transaction(() => {
    if (mods) {
      const total = totalOf(score, mods);
      raiseModded.run(
        key,
        song,
        level,
        mods,
        total,
        accuracy,
        fc ? 1 : 0,
        played,
        Date.now(),
        sha256,
      );
      return { key, song, level, raised: false };
    }
    const raised = raiseBest(key, song, level, { score, accuracy, fc, played, sha256 });
    updateRks(key);
    return { key, song, level, raised };
  })();
}

const about = sqlite.prepare<
  PlayerName & {
    song: string;
    level: string;
    header: string;
    status: ReplayInfo["status"];
    timing: number | null;
    mods: number;
  },
  [string]
>(
  `SELECT r.song, r.level, r.header, r.status, r.timing, r.mods, p.id, p.name, p.number, p.avatar
   FROM replays r JOIN players p ON p.key = r.key WHERE r.sha256 = ?`,
);

/** Who played a replay and what they got. */
export function replayInfo(sha256: string): ReplayInfo | undefined {
  const row = about.get(sha256);
  if (!row) return undefined;
  const header = JSON.parse(row.header) as ReplayHeader;
  return {
    player: { id: row.id, name: row.name, number: row.number, avatar: row.avatar },
    song: row.song,
    level: row.level,
    status: row.status,
    date: header.date * 1000,
    score: header.score,
    mods: row.mods,
    total: totalOf(header.score, row.mods),
    accuracy: header.accuracy,
    timing: row.timing,
    fc: header.bad + header.miss === 0,
    maxcombo: header.maxcombo,
    perfect: header.perfect,
    good: header.good,
    bad: header.bad,
    miss: header.miss,
    phigrospp: header.phigrospp,
    // "mods/hud.lua:1a2b3c4d,core/sync.lua:..." without the hashes
    files: header.files ? header.files.split(",").map((file) => file.replace(/:[^:]*$/, "")) : [],
  };
}

// a statement over a board's rows for each board: the bests of a scope, or the ones with modifiers. from(joins) is
// its FROM up to the conditions of its own
const BOARDS = [
  ["bests", "b.scope = 0 AND"],
  ["bests", "b.scope = 1 AND"],
  ["modded", ""],
] as const;
const boards = <T, P extends unknown[]>(sql: (from: (joins: string) => string) => string) =>
  BOARDS.map(([table, scope]) =>
    sqlite.prepare<T, P>(sql((joins) => `${table} b ${joins} WHERE ${scope}`)),
  );

const chartPage = boards<
  PlayerName & {
    sha256: string | null;
    score: number;
    total: number;
    mods: number;
    accuracy: number;
    fc: number;
    played: number | null;
    status: string | null;
    timing: number | null;
  },
  [string, string, number, number]
>(
  (from) =>
    `SELECT b.sha256, COALESCE(r.score, b.score) AS score, b.score AS total, COALESCE(r.mods, 0) AS mods,
     b.accuracy, b.fc, b.played, r.status, r.timing, p.id, p.name, p.number, p.avatar
     FROM ${from("LEFT JOIN replays r ON r.sha256 = b.sha256 JOIN players p ON p.key = b.key")}
     b.song = ? AND b.level = ? AND p.unlisted = 0
     ORDER BY b.score DESC, b.played IS NULL, b.played, b.created LIMIT ? OFFSET ?`,
);
const chartCount = boards<{ count: number }, [string, string]>(
  (from) =>
    `SELECT COUNT(*) AS count FROM ${from("JOIN players p ON p.key = b.key")}
     b.song = ? AND b.level = ? AND p.unlisted = 0`,
);

/**
 * A chart's players on a board, best score first and on a tie the earliest verified replay, then the earliest record.
 * With modifiers it's each player's best with each set of them, best total first.
 */
export function chartPlays(
  board: Board,
  song: string,
  level: string,
  limit: number,
  offset: number,
): ChartPlays {
  const plays = chartPage[board]!.all(song, level, limit, offset).map((row, index) => ({
    id: row.sha256 ?? `imported:${row.id}`,
    replay: row.sha256,
    rank: offset + index + 1,
    player: { id: row.id, name: row.name, number: row.number, avatar: row.avatar },
    score: row.score,
    mods: row.mods,
    total: row.total,
    accuracy: row.accuracy,
    timing: row.timing,
    fc: row.fc === 1,
    status: (row.status ?? "imported") as PlayStatus,
    date: row.played,
  }));
  return { count: chartCount[board]!.get(song, level)!.count, plays };
}

const place = sqlite.prepare<{ rank: number }, [Uint8Array, string, string]>(
  `SELECT 1 + (SELECT COUNT(*) FROM bests b JOIN players p ON p.key = b.key
     WHERE b.scope = 0 AND b.song = mine.song AND b.level = mine.level AND b.score > mine.score AND p.unlisted = 0)
   AS rank FROM bests mine WHERE mine.key = ? AND mine.song = ? AND mine.level = ? AND mine.scope = 0`,
);

/** Where a player's best stands on a chart counting all plays, undefined if they have none there. */
export const chartPlace = (key: Uint8Array, song: string, level: string) =>
  place.get(key, song, level)?.rank;

// the listed players with their rank by the scope's RKS, the ones whose name holds the search (a pattern for LIKE,
// "%" for all) and whose number is the searched one (0 for any)
const ranked = (
  rks: string,
) => `SELECT * FROM (SELECT id, name, fold, number, avatar, ${rks} AS rks,
  ROW_NUMBER() OVER (ORDER BY ${rks} DESC, ${rks}_at) AS rank FROM players WHERE ${rks} > 0 AND unlisted = 0)
  WHERE fold LIKE ?1 ESCAPE '\\' AND (?2 = 0 OR number = ?2)`;
const RKS = ["rks", "rks_verified"] as const;
const playerPage = RKS.map((rks) =>
  sqlite.prepare<PlayerName & { rks: number; rank: number }, [string, number, number, number]>(
    `${ranked(rks)} ORDER BY rank LIMIT ?3 OFFSET ?4`,
  ),
);
const playerCount = RKS.map((rks) =>
  sqlite.prepare<{ count: number }, [string, number]>(
    `SELECT COUNT(*) AS count FROM (${ranked(rks)})`,
  ),
);

/**
 * Players by RKS, the earliest to reach it first on a tie, those matching a search if there's one: part of the name,
 * then "#0042" for a number.
 */
export function playerRanking(
  scope: Scope,
  limit: number,
  offset: number,
  search = "",
): PlayerRanking {
  const [name = "", number = ""] = search.trim().split("#");
  const pattern = `%${fold(name).replace(/[\\%_]/g, "\\$&")}%`;
  const wanted = Number.parseInt(number, 10) || 0;
  const players = playerPage[scope]!.all(pattern, wanted, limit, offset).map((row) => ({
    rank: row.rank,
    player: { id: row.id, name: row.name, number: row.number, avatar: row.avatar },
    rks: row.rks,
  }));
  return { count: playerCount[scope]!.get(pattern, wanted)!.count, players };
}

const counts = boards<ChartCount, []>(
  (from) =>
    `SELECT b.song, b.level, COUNT(*) AS count FROM ${from("JOIN players p ON p.key = b.key")}
     p.unlisted = 0 GROUP BY b.song, b.level ORDER BY count DESC`,
);
const cached: { at: number; charts: ChartCount[] }[] = [];

/** Every chart with a best on the board, most players first. Counted at most once a minute, as it reads every best. */
export function chartCounts(board: Board): ChartCount[] {
  if (!cached[board] || Date.now() - cached[board].at > 60_000)
    cached[board] = { at: Date.now(), charts: counts[board]!.all() };
  return cached[board].charts;
}
