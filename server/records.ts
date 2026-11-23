import { and, eq } from "drizzle-orm";
import { HTTPError } from "nitro/h3";
import { canonicalSongId } from "../src/catalog";
import { LEVELS, type LevelName } from "../src/modules";
import { db, excluded, lock } from "./db";
import { raiseBests, updateRks } from "./replays";
import * as t from "./schema";

// the records a player's game says it has are imported, the ones a player typed on the site are declared (see the
// tables in server/schema.ts). more of them than the game has charts are refused, which also keeps each insert
// under the 65535 values a statement takes
const MAX = 4000;
const { bests, declared, imported } = t;

/** Records, one per line: `<game song id>\t<level>\t<score>\t<accuracy>\t<1 if full combo>`. Levels the site doesn't
 * rank (the game's Legacy charts) are skipped. Two of the game's songs can be one of the site's: the higher stays. */
function parse(text: string) {
  const lines = text
    .split("\n")
    .filter((line) => LEVELS.includes(line.split("\t")[1] as LevelName));
  if (lines.length > MAX) throw HTTPError.status(413, "Too many records");
  const read = (line: string) => {
    const [song = "", level = "", score, accuracy, fc] = line.split("\t");
    const record = {
      song: canonicalSongId(song.replace(/\.0$/, "")),
      level,
      score: Number(score),
      accuracy: Number(accuracy),
      fc: fc === "1",
    };
    if (
      !Number.isInteger(record.score) ||
      record.score < 0 ||
      record.score > 1_000_000 ||
      !(record.accuracy >= 0 && record.accuracy <= 100)
    )
      throw HTTPError.status(400, `Bad record: ${line}`);
    return record;
  };
  const records = new Map<string, ReturnType<typeof read>>();
  for (const record of lines.map(read)) {
    const chart = `${record.song}\t${record.level}`;
    if (record.score >= (records.get(chart)?.score ?? 0)) records.set(chart, record);
  }
  return { count: lines.length, records };
}

/**
 * The records a player's game has. How many were read, the ones that became the player's best, and the player's bests
 * that beat what was sent (from another device or install), for the game to take them back.
 */
export async function importRecords(key: Uint8Array, text: string) {
  const { count, records } = parse(text);
  const sent = [...records.values()];
  const updated = Date.now();
  // they count on the leaderboard like replays, where nothing better from the player is there
  const raised = await db.transaction(async (tx) => {
    await lock(tx, key);
    if (!sent.length) return [];
    await tx
      .insert(imported)
      .values(sent.map((record) => ({ ...record, key, updated })))
      .onConflictDoUpdate({
        target: [imported.key, imported.song, imported.level],
        set: {
          score: excluded(imported.score),
          accuracy: excluded(imported.accuracy),
          fc: excluded(imported.fc),
          updated: excluded(imported.updated),
        },
      });
    const raised = await raiseBests(
      tx,
      key,
      sent.map((record) => ({ ...record, played: null, sha256: null })),
    );
    await updateRks(tx, key);
    return raised;
  });
  const mine = await db
    .select()
    .from(bests)
    .where(and(eq(bests.key, key), eq(bests.scope, 0)))
    .orderBy(bests.song, bests.level);
  const better = mine
    .filter((best) => {
      const game = records.get(`${best.song}\t${best.level}`);
      return (
        !game || best.score > game.score || best.accuracy > game.accuracy || (best.fc && !game.fc)
      );
    })
    // the game reads fc as a number
    .map(({ song, level, score, accuracy, fc }) => ({
      song,
      level,
      score,
      accuracy,
      fc: Number(fc),
    }));
  return { count, raised, better };
}

/** The records a player typed on the site, in place of the ones they declared before: each is kept where it's above
 * their best, and counts once a play from the game reaches it (see raiseBests). How many were read. */
export async function declareRecords(key: Uint8Array, text: string) {
  const { count, records } = parse(text);
  await db.transaction(async (tx) => {
    await lock(tx, key);
    await tx.delete(declared).where(eq(declared.key, key));
    const mine = await tx
      .select()
      .from(bests)
      .where(and(eq(bests.key, key), eq(bests.scope, 0)));
    const reached = new Map(mine.map((best) => [`${best.song}\t${best.level}`, best.score]));
    const above = [...records]
      .filter(([chart, record]) => (reached.get(chart) ?? -1) < record.score)
      .map(([, record]) => ({ ...record, key }));
    if (above.length) await tx.insert(declared).values(above);
  });
  return count;
}
