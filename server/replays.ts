import { mkdirSync } from "node:fs";
import { calculateRanking } from "../src/metrics";
import { LEVELS, type LevelName, type SongRecord } from "../src/modules";
import type { ReplayHeader } from "../src/pigeon";
import type { ChartCount, ChartPlays, PlayerName, PlayerRanking, PlayStatus } from "../src/plays";
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
sqlite.run("CREATE INDEX IF NOT EXISTS idx_replays_key ON replays(key)");
// each player's best on each chart, so a chart's ranking is read in order from the index: a verified replay (sha256),
// or a record their game declared (imported, no sha256, no date). created is when it became the best, for ties
sqlite.run(`
  CREATE TABLE IF NOT EXISTS bests (
    key BLOB NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    score INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    fc INTEGER NOT NULL,
    played INTEGER,
    created INTEGER NOT NULL,
    sha256 TEXT,
    PRIMARY KEY (key, song, level)
  )
`);
sqlite.run("CREATE INDEX IF NOT EXISTS idx_bests_rank ON bests(song, level, score DESC, created)");
const insert = sqlite.prepare<
  unknown,
  [string, Uint8Array, string, string, number, number, string, number]
>(
  `INSERT INTO replays (sha256, key, song, level, score, game, header, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (sha256) DO NOTHING`,
);
// a higher score replaces the best, and so does a replay of the score an imported record declared
const raise = sqlite.prepare<
  unknown,
  [Uint8Array, string, string, number, number, number, number | null, number, string | null]
>(
  `INSERT INTO bests (key, song, level, score, accuracy, fc, played, created, sha256)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (key, song, level) DO UPDATE SET score = excluded.score, accuracy = excluded.accuracy,
   fc = excluded.fc, played = excluded.played, sha256 = excluded.sha256,
   created = CASE WHEN excluded.score > bests.score THEN excluded.created ELSE bests.created END
   WHERE excluded.score > bests.score
     OR (excluded.score = bests.score AND bests.sha256 IS NULL AND excluded.sha256 IS NOT NULL)`,
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

export function raiseBest(key: Uint8Array, song: string, level: string, best: Best) {
  const { score, accuracy, fc, played, sha256 } = best;
  raise.run(key, song, level, score, accuracy, fc ? 1 : 0, played, Date.now(), sha256);
}
const playerBests = sqlite.prepare<
  { song: string; level: LevelName; score: number; accuracy: number },
  [Uint8Array]
>("SELECT song, level, score, accuracy FROM bests WHERE key = ?");
/** A player's RKS from their bests, counted like the game: best 27 plus the 3 best Phi charts. */
export function updateRks(key: Uint8Array) {
  const songs = new Map<string, Pick<SongRecord, "songId" | "fc" | "levels">>();
  for (const best of playerBests.all(key)) {
    const song = songs.get(best.song) ?? {
      songId: best.song,
      fc: 0,
      levels: [null, null, null, null],
    };
    song.levels[LEVELS.indexOf(best.level)] = best;
    songs.set(best.song, song);
  }
  setRks(key, calculateRanking({ songs: [...songs.values()] }, "b30").rankingScore);
}

/** Keeps an uploaded replay, pending until the worker judged it (server/worker.ts). */
export function addReplay(sha256: string, key: Uint8Array, song: string, header: ReplayHeader) {
  const json = JSON.stringify(header);
  insert.run(sha256, key, song, header.difficulty, header.score, header.game, json, Date.now());
}

const verified = sqlite.prepare<{ key: Uint8Array; song: string; level: string }, [string]>(
  "SELECT key, song, level FROM replays WHERE sha256 = ?",
);

/** A replay the worker verified counts: it can become its player's best on the chart, and their RKS follows. */
export function countReplay(sha256: string, header: ReplayHeader) {
  const { key, song, level } = verified.get(sha256)!;
  sqlite.transaction(() => {
    raiseBest(key, song, level, {
      score: header.score,
      accuracy: header.accuracy,
      fc: header.bad + header.miss === 0,
      played: header.date * 1000,
      sha256,
    });
    updateRks(key);
  })();
}

const chartPage = sqlite.prepare<
  PlayerName & {
    sha256: string | null;
    score: number;
    accuracy: number;
    fc: number;
    played: number | null;
    status: string | null;
  },
  [string, string, number, number]
>(
  `SELECT b.sha256, b.score, b.accuracy, b.fc, b.played, r.status, p.id, p.name, p.number, p.avatar FROM bests b
   LEFT JOIN replays r ON r.sha256 = b.sha256 JOIN players p ON p.key = b.key
   WHERE b.song = ? AND b.level = ? AND p.unlisted = 0 ORDER BY b.score DESC, b.created LIMIT ? OFFSET ?`,
);
const chartCount = sqlite.prepare<{ count: number }, [string, string]>(
  `SELECT COUNT(*) AS count FROM bests b JOIN players p ON p.key = b.key
   WHERE b.song = ? AND b.level = ? AND p.unlisted = 0`,
);

/** A chart's players, best score first and the earliest to reach it on a tie. */
export function chartPlays(song: string, level: string, limit: number, offset: number): ChartPlays {
  const plays = chartPage.all(song, level, limit, offset).map((row, index) => ({
    id: row.sha256 ?? `imported:${row.id}`,
    replay: row.sha256,
    rank: offset + index + 1,
    player: { id: row.id, name: row.name, number: row.number, avatar: row.avatar },
    score: row.score,
    accuracy: row.accuracy,
    fc: row.fc === 1,
    status: (row.status ?? "imported") as PlayStatus,
    date: row.played,
  }));
  return { count: chartCount.get(song, level)!.count, plays };
}

// the listed players with their rank, the ones whose name holds the search (a pattern for LIKE, "%" for all) and
// whose number is the searched one (0 for any)
const RANKED = `SELECT * FROM (SELECT id, name, fold, number, avatar, rks,
  ROW_NUMBER() OVER (ORDER BY rks DESC, rks_at) AS rank FROM players WHERE rks > 0 AND unlisted = 0)
  WHERE fold LIKE ?1 ESCAPE '\\' AND (?2 = 0 OR number = ?2)`;
const playerPage = sqlite.prepare<
  PlayerName & { rks: number; rank: number },
  [string, number, number, number]
>(`${RANKED} ORDER BY rank LIMIT ?3 OFFSET ?4`);
const playerCount = sqlite.prepare<{ count: number }, [string, number]>(
  `SELECT COUNT(*) AS count FROM (${RANKED})`,
);

/**
 * Players by RKS, the earliest to reach it first on a tie, those matching a search if there's one: part of the name,
 * then "#0042" for a number.
 */
export function playerRanking(limit: number, offset: number, search = ""): PlayerRanking {
  const [name = "", number = ""] = search.trim().split("#");
  const pattern = `%${fold(name).replace(/[\\%_]/g, "\\$&")}%`;
  const wanted = Number.parseInt(number, 10) || 0;
  const players = playerPage.all(pattern, wanted, limit, offset).map((row) => ({
    rank: row.rank,
    player: { id: row.id, name: row.name, number: row.number, avatar: row.avatar },
    rks: row.rks,
  }));
  return { count: playerCount.get(pattern, wanted)!.count, players };
}

const counts = sqlite.prepare<ChartCount, []>(
  `SELECT b.song, b.level, COUNT(*) AS count FROM bests b JOIN players p ON p.key = b.key
   WHERE p.unlisted = 0 GROUP BY b.song, b.level ORDER BY count DESC`,
);
let cached: { at: number; charts: ChartCount[] } | undefined;

/** Every chart with an uploaded play or record, most players first. Counted at most once a minute, as it reads every best. */
export function chartCounts(): ChartCount[] {
  if (!cached || Date.now() - cached.at > 60_000) cached = { at: Date.now(), charts: counts.all() };
  return cached.charts;
}
