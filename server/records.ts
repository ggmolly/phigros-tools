import { HTTPError } from "nitro/h3";
import { canonicalSongId } from "../src/catalog";
import { LEVELS, type LevelName } from "../src/modules";
import { sqlite } from "./db";
import { raiseBest, updateRks } from "./replays";

// the records a player's game says it has, sent as they are: nothing proves them, the site shows them as imported.
// the ones a player typed on the site are declared (see the table in server/replays.ts)
sqlite.run(`
  CREATE TABLE IF NOT EXISTS imported (
    key BLOB NOT NULL,
    song TEXT NOT NULL,
    level TEXT NOT NULL,
    score INTEGER NOT NULL,
    accuracy REAL NOT NULL,
    fc INTEGER NOT NULL,
    updated INTEGER NOT NULL,
    PRIMARY KEY (key, song, level)
  )
`);

const MAX = 4000; // more records than the game has charts
const upsert = sqlite.prepare<
  unknown,
  [Uint8Array, string, string, number, number, number, number]
>(
  `INSERT INTO imported (key, song, level, score, accuracy, fc, updated) VALUES (?, ?, ?, ?, ?, ?, ?)
   ON CONFLICT (key, song, level) DO UPDATE SET score = excluded.score, accuracy = excluded.accuracy,
   fc = excluded.fc, updated = excluded.updated`,
);
const bests = sqlite.prepare<
  { song: string; level: string; score: number; accuracy: number; fc: number },
  [Uint8Array]
>("SELECT song, level, score, accuracy, fc FROM bests WHERE key = ? AND scope = 0");

const forget = sqlite.prepare<unknown, [Uint8Array]>("DELETE FROM declared WHERE key = ?");
const declare = sqlite.prepare<unknown, [Uint8Array, string, string, number, number, number]>(
  `INSERT INTO declared (key, song, level, score, accuracy, fc) SELECT ?1, ?2, ?3, ?4, ?5, ?6
   WHERE NOT EXISTS (SELECT 1 FROM bests WHERE key = ?1 AND song = ?2 AND level = ?3 AND scope = 0 AND score >= ?4)`,
);

/** Records, one per line: `<game song id>\t<level>\t<score>\t<accuracy>\t<1 if full combo>`. Levels the site doesn't
 * rank (the game's Legacy charts) are skipped. */
function parse(text: string) {
  const lines = text
    .split("\n")
    .filter((line) => LEVELS.includes(line.split("\t")[1] as LevelName));
  if (lines.length > MAX) throw HTTPError.status(413, "Too many records");
  return lines.map((line) => {
    const [song = "", level = "", score, accuracy, fc] = line.split("\t");
    const record = {
      song: canonicalSongId(song.replace(/\.0$/, "")),
      level,
      score: Number(score),
      accuracy: Number(accuracy),
      fc: fc === "1" ? 1 : 0,
    };
    if (
      !Number.isInteger(record.score) ||
      record.score < 0 ||
      record.score > 1_000_000 ||
      !(record.accuracy >= 0 && record.accuracy <= 100)
    )
      throw HTTPError.status(400, `Bad record: ${line}`);
    return record;
  });
}

/**
 * The records a player's game has. How many were read, the ones that became the player's best, and the player's bests
 * that beat what was sent (from another device or install), for the game to take them back.
 */
export function importRecords(key: Uint8Array, text: string) {
  const records = parse(text);
  const now = Date.now();
  // they count on the leaderboard like replays, where nothing better from the player is there
  const raised = sqlite.transaction(() => {
    const raised = records.filter((r) => {
      upsert.run(key, r.song, r.level, r.score, r.accuracy, r.fc, now);
      return raiseBest(key, r.song, r.level, { ...r, fc: r.fc === 1, played: null, sha256: null });
    });
    updateRks(key);
    return raised;
  })();
  const sent = new Map(records.map((r) => [`${r.song}\t${r.level}`, r]));
  const better = bests.all(key).filter((best) => {
    const mine = sent.get(`${best.song}\t${best.level}`);
    return !mine || best.score > mine.score || best.accuracy > mine.accuracy || best.fc > mine.fc;
  });
  return { count: records.length, raised, better };
}

/** The records a player typed on the site, in place of the ones they declared before: each is kept where it's above
 * their best, and counts once a play from the game reaches it (see raiseBest). How many were read. */
export function declareRecords(key: Uint8Array, text: string) {
  const records = parse(text);
  sqlite.transaction(() => {
    forget.run(key);
    for (const r of records) declare.run(key, r.song, r.level, r.score, r.accuracy, r.fc);
  })();
  return records.length;
}
