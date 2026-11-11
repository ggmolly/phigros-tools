import { HTTPError } from "nitro/h3";
import { canonicalSongId } from "../src/catalog";
import { LEVELS, type LevelName } from "../src/modules";
import { sqlite } from "./db";
import { raiseBest, updateRks } from "./replays";

// the records a player's game says it has, sent as they are: nothing proves them, the site shows them as imported
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

/**
 * A player's records, one per line: `<game song id>\t<level>\t<score>\t<accuracy>\t<1 if full combo>`. Levels the site
 * doesn't rank (the game's Legacy charts) are skipped.
 */
export function importRecords(key: Uint8Array, text: string): number {
  const lines = text
    .split("\n")
    .filter((line) => LEVELS.includes(line.split("\t")[1] as LevelName));
  if (lines.length > MAX) throw HTTPError.status(413, "Too many records");
  const records = lines.map((line) => {
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
  const now = Date.now();
  // they count on the leaderboard like replays, where nothing better from the player is there
  sqlite.transaction(() => {
    for (const r of records) {
      upsert.run(key, r.song, r.level, r.score, r.accuracy, r.fc, now);
      raiseBest(key, r.song, r.level, { ...r, fc: r.fc === 1, played: null, sha256: null });
    }
    updateRks(key);
  })();
  return records.length;
}
