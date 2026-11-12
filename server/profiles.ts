import { HTTPError } from "nitro/h3";
import { canonicalSongId, catalogSong } from "../src/catalog";
import { chartRks } from "../src/metrics";
import { LEVELS, type LevelName } from "../src/modules";
import {
  type Activity,
  LIST_FIRST,
  type Page,
  type PlayedChart,
  type PlayerName,
  type PlayerProfile,
  type PlayStatus,
} from "../src/plays";
import { sqlite } from "./db";
import "./replays"; // the bests and replays tables

// what a player's page shows besides their bests: every song they finished (a summary sent by the game, no replay),
// the rank each new best took on its chart, and their RKS and rank once a day
sqlite.run(`
  CREATE TABLE IF NOT EXISTS plays (
    key BLOB NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    score INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    maxcombo INTEGER NOT NULL,
    perfect INTEGER NOT NULL,
    good INTEGER NOT NULL,
    bad INTEGER NOT NULL,
    miss INTEGER NOT NULL,
    duration REAL NOT NULL,
    played INTEGER NOT NULL,
    PRIMARY KEY (key, played, song, level)
  )
`);
sqlite.run(`
  CREATE TABLE IF NOT EXISTS activity (
    key BLOB NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    score INTEGER NOT NULL,
    rank INTEGER NOT NULL,
    at INTEGER NOT NULL
  )
`);
sqlite.run("CREATE INDEX IF NOT EXISTS idx_activity_key ON activity(key, at DESC)");
sqlite.run(`
  CREATE TABLE IF NOT EXISTS history (
    key BLOB NOT NULL,
    day TEXT NOT NULL,
    rks REAL NOT NULL,
    rank INTEGER NOT NULL,
    PRIMARY KEY (key, day)
  )
`);

const MAX_PLAYS = 500;
const insertPlay = sqlite.prepare<
  unknown,
  [
    Uint8Array,
    string,
    string,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ]
>(
  `INSERT INTO plays (key, song, level, score, accuracy, maxcombo, perfect, good, bad, miss, duration, played)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
);

/**
 * Songs a player finished, one JSON object per line as the game sends them. Sending one again changes nothing. Levels
 * the site doesn't rank (the game's Legacy charts) are skipped.
 */
export function addPlays(key: Uint8Array, text: string): number {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length > MAX_PLAYS) throw HTTPError.status(413, "Too many plays");
  const plays = lines.flatMap((line) => {
    const p = JSON.parse(line) as Record<string, unknown>;
    const n = (field: string) => {
      const value = Number(p[field]);
      if (!Number.isFinite(value) || value < 0)
        throw HTTPError.status(400, `Bad ${field}: ${line}`);
      return value;
    };
    const level = String(p.level);
    if (!LEVELS.includes(level as LevelName)) return [];
    return {
      song: canonicalSongId(String(p.song).replace(/\.0$/, "")),
      level,
      score: n("score"),
      accuracy: Math.min(100, n("accuracy")),
      maxcombo: n("maxcombo"),
      perfect: n("perfect"),
      good: n("good"),
      bad: n("bad"),
      miss: n("miss"),
      duration: n("duration"),
      played: n("date") * 1000,
    };
  });
  sqlite.transaction(() => {
    for (const p of plays)
      insertPlay.run(
        key,
        p.song,
        p.level,
        p.score,
        p.accuracy,
        p.maxcombo,
        p.perfect,
        p.good,
        p.bad,
        p.miss,
        p.duration,
        p.played,
      );
  })();
  return plays.length;
}

const higher = sqlite.prepare<{ above: number }, [string, string, number]>(
  `SELECT COUNT(*) AS above FROM bests b JOIN players p ON p.key = b.key
   WHERE b.scope = 0 AND b.song = ? AND b.level = ? AND b.score > ? AND p.unlisted = 0`,
);
const addActivity = sqlite.prepare<unknown, [Uint8Array, string, string, number, number, number]>(
  "INSERT INTO activity (key, song, level, score, rank, at) VALUES (?, ?, ?, ?, ?, ?)",
);

/** A verified replay became the player's best: the rank it took on its chart goes to their activity. */
export function addAchievement(key: Uint8Array, song: string, level: string, score: number) {
  addActivity.run(key, song, level, score, higher.get(song, level, score)!.above + 1, Date.now());
}

const snapshot = sqlite.prepare<unknown, [string]>(
  `INSERT OR REPLACE INTO history (key, day, rks, rank)
   SELECT key, ?, rks, ROW_NUMBER() OVER (ORDER BY rks DESC, rks_at) FROM players WHERE rks > 0 AND unlisted = 0`,
);

/** Keeps today's RKS and rank of every listed player, the last call of a day staying. */
export function snapshotHistory() {
  snapshot.run(new Date().toISOString().slice(0, 10));
}

const card = sqlite.prepare<
  PlayerName & {
    key: Uint8Array;
    intro: string;
    rks: number;
    unlisted: number;
    created: number;
    seen: number;
    background: string;
  },
  [string]
>(
  "SELECT key, id, name, number, avatar, intro, rks, unlisted, created, seen, background FROM players WHERE id = ?",
);
const rankOf = sqlite.prepare<{ rank: number }, [Uint8Array]>(
  `SELECT rank FROM (SELECT key, ROW_NUMBER() OVER (ORDER BY rks DESC, rks_at) AS rank FROM players
   WHERE rks > 0 AND unlisted = 0) WHERE key = ?`,
);
const totals = sqlite.prepare<
  { plays: number; notes: number; accuracy: number | null; maxcombo: number },
  [Uint8Array]
>(
  `SELECT COUNT(*) AS plays, COALESCE(SUM(perfect + good + bad), 0) AS notes,
   AVG(accuracy) AS accuracy, COALESCE(MAX(maxcombo), 0) AS maxcombo FROM plays WHERE key = ?`,
);
const bestsOf = sqlite.prepare<
  {
    song: string;
    level: string;
    score: number;
    accuracy: number;
    fc: number;
    played: number | null;
    status: string | null;
    sha256: string | null;
  },
  [Uint8Array]
>(
  `SELECT b.song, b.level, b.score, b.accuracy, b.fc, b.played, r.status, b.sha256 FROM bests b
   LEFT JOIN replays r ON r.sha256 = b.sha256 WHERE b.key = ? AND b.scope = 0`,
);
const recentOf = sqlite.prepare<
  {
    song: string;
    level: string;
    score: number;
    accuracy: number;
    bad: number;
    miss: number;
    played: number;
    replay: string | null;
  },
  [Uint8Array, number, number]
>(
  `SELECT p.song, p.level, p.score, p.accuracy, p.bad, p.miss, p.played,
   (SELECT r.sha256 FROM replays r WHERE r.key = p.key AND r.song = p.song AND r.level = p.level
    AND r.score = p.score AND r.status = 'verified' LIMIT 1) AS replay
   FROM plays p WHERE p.key = ? ORDER BY p.played DESC LIMIT ? OFFSET ?`,
);
const activityOf = sqlite.prepare<
  { song: string; level: string; score: number; rank: number; at: number },
  [Uint8Array, number, number]
>(
  "SELECT song, level, score, rank, at FROM activity WHERE key = ? ORDER BY at DESC LIMIT ? OFFSET ?",
);
const historyOf = sqlite.prepare<{ day: string; rks: number; rank: number }, [Uint8Array]>(
  "SELECT day, rks, rank FROM history WHERE key = ? ORDER BY day DESC LIMIT 365",
);

const keyOf = sqlite.prepare<{ key: Uint8Array }, [string]>("SELECT key FROM players WHERE id = ?");

// one row past the page tells whether there's another
function page<T>(rows: T[], limit: number): Page<T> {
  return { items: rows.slice(0, limit), more: rows.length > limit };
}

function recentPlays(key: Uint8Array, offset: number, limit: number): Page<PlayedChart> {
  const rows = recentOf.all(key, limit + 1, offset).map((play) => ({
    song: play.song,
    level: play.level,
    score: play.score,
    accuracy: play.accuracy,
    fc: play.bad + play.miss === 0,
    date: play.played,
    replay: play.replay,
  }));
  return page(rows, limit);
}

function activities(key: Uint8Array, offset: number, limit: number): Page<Activity> {
  const rows = activityOf
    .all(key, limit + 1, offset)
    .map(({ at, ...rest }) => ({ ...rest, date: at }));
  return page(rows, limit);
}

const LISTS = { recent: recentPlays, activity: activities };

/** More of a player's recent plays or activity, after the ones already shown. */
export function profileList(id: string, list: string, offset: number, limit: number) {
  const key = keyOf.get(id)?.key;
  const read = LISTS[list as keyof typeof LISTS];
  return key && read ? read(key, offset, limit) : undefined;
}

const BEST = 27;
const PHI = 3;

/** A player's page: their card, rank, stats, top and recent plays, activity and RKS history. */
export function profilePage(id: string): PlayerProfile | undefined {
  const row = card.get(id);
  if (!row) return undefined;
  const top = bestsOf
    .all(row.key)
    .map((best) => {
      const constant = catalogSong(best.song)?.constants[LEVELS.indexOf(best.level as LevelName)];
      return {
        song: best.song,
        level: best.level,
        score: best.score,
        accuracy: best.accuracy,
        fc: best.fc === 1,
        date: best.played,
        replay: best.sha256,
        status: (best.status ?? "imported") as PlayStatus,
        rks: constant == null ? 0 : chartRks(best.accuracy, constant),
        counted: false,
      };
    })
    .sort((a, b) => b.rks - a.rks);
  // counted like the game's RKS: the 27 best charts, and the 3 best of those with 100% accuracy
  for (const best of top.slice(0, BEST)) best.counted = true;
  for (const best of top.filter((b) => b.accuracy >= 100).slice(0, PHI)) best.counted = true;
  const rank = row.unlisted ? null : (rankOf.get(row.key)?.rank ?? null);
  // the worker keeps a day hourly (snapshotHistory), today's point follows the RKS shown above it
  const history = historyOf.all(row.key).reverse();
  const today = new Date().toISOString().slice(0, 10);
  if (rank !== null && row.rks > 0) {
    if (history.at(-1)?.day === today) history.pop();
    history.push({ day: today, rks: row.rks, rank });
  }
  return {
    player: { id: row.id, name: row.name, number: row.number, avatar: row.avatar },
    intro: row.intro,
    background: row.background,
    rks: row.rks,
    rank,
    joined: row.created,
    seen: Math.max(row.seen, row.created),
    stats: {
      ...totals.get(row.key)!,
      cleared: top.length,
      fc: top.filter((best) => best.fc).length,
      phi: top.filter((best) => best.score >= 1_000_000).length,
    },
    top,
    recent: recentPlays(row.key, 0, LIST_FIRST),
    activity: activities(row.key, 0, LIST_FIRST),
    history,
  };
}
