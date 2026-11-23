import { mkdirSync } from "node:fs";
import { and, count, desc, eq, gt, like, lte, or, sql } from "drizzle-orm";
import { calculateRanking } from "../src/metrics";
import { totalOf } from "../src/modifiers";
import { LEVELS, type LevelName, type SongRecord } from "../src/modules";
import type { ReplayHeader } from "../src/pigeon";
import type {
  Board,
  ChartCount,
  ChartPlays,
  PlayerRanking,
  PlayStatus,
  ReplayInfo,
} from "../src/plays";
import { db, excluded, type Tx } from "./db";
import { fold, NAME, setRks } from "./players";
import * as t from "./schema";

export const REPLAY_DIR = "./data/replays";
mkdirSync(REPLAY_DIR, { recursive: true });

const { bests, declared, modded, players, replays } = t;

/** What a leaderboard counts: all (verified replays and imported records), or verified replays only. */
export type Scope = 0 | 1;

export interface Best {
  song: string;
  level: string;
  score: number;
  accuracy: number;
  fc: boolean;
  /** When it was played, in ms, null for an imported record. */
  played: number | null;
  /** The replay proving it, null for an imported record. */
  sha256: string | null;
}

/**
 * A record counts for all, a verified replay for both scopes: the charts where one became the player's best counting
 * all. A record no higher than the one the player declared is their rebuilt save sent back by the game, and counts
 * for nothing; anything reaching the declared score takes its place. A chart is given once.
 */
export async function raiseBests(tx: Tx, key: Uint8Array, given: Best[]) {
  const chart = (of: { song: string; level: string }) => `${of.song}\t${of.level}`;
  const typed = new Map(
    (await tx.select().from(declared).where(eq(declared.key, key))).map((d) => [chart(d), d.score]),
  );
  const counted = given.filter(
    (best) => best.sha256 || (typed.get(chart(best)) ?? -1) < best.score,
  );
  if (!counted.length) return [];
  const reached = counted.filter((best) => typed.has(chart(best)));
  if (reached.length)
    await tx
      .delete(declared)
      .where(
        and(
          eq(declared.key, key),
          or(
            ...reached.map((best) =>
              and(
                eq(declared.song, best.song),
                eq(declared.level, best.level),
                lte(declared.score, best.score),
              ),
            ),
          ),
        ),
      );
  const created = Date.now();
  // a higher score replaces the best, and so does a replay of the score an imported record has
  const raise = (scope: Scope, rows: Best[]) =>
    tx
      .insert(bests)
      .values(rows.map((best) => ({ ...best, key, scope, created })))
      .onConflictDoUpdate({
        target: [bests.key, bests.song, bests.level, bests.scope],
        set: {
          score: excluded(bests.score),
          accuracy: excluded(bests.accuracy),
          fc: excluded(bests.fc),
          played: excluded(bests.played),
          sha256: excluded(bests.sha256),
          created: sql`case when excluded.score > ${bests.score} then excluded.created else ${bests.created} end`,
        },
        setWhere: sql`excluded.score > ${bests.score}
          or (excluded.score = ${bests.score} and ${bests.sha256} is null and excluded.sha256 is not null)`,
      })
      .returning({ song: bests.song, level: bests.level });
  const raised = await raise(0, counted);
  const proven = counted.filter((best) => best.sha256);
  if (proven.length) await raise(1, proven);
  return raised;
}

/** A player's RKS from their bests in a scope, counted like the game: best 27 plus the 3 best Phi charts. */
async function rksOf(tx: Tx, key: Uint8Array, scope: Scope) {
  const songs = new Map<string, Pick<SongRecord, "songId" | "fc" | "levels">>();
  const rows = await tx
    .select()
    .from(bests)
    .where(and(eq(bests.key, key), eq(bests.scope, scope)));
  for (const best of rows) {
    const song = songs.get(best.song) ?? {
      songId: best.song,
      fc: 0,
      levels: [null, null, null, null],
    };
    song.levels[LEVELS.indexOf(best.level as LevelName)] = best;
    songs.set(best.song, song);
  }
  return calculateRanking({ songs: [...songs.values()] }, "b30").rankingScore;
}

export const updateRks = async (tx: Tx, key: Uint8Array) =>
  setRks(tx, key, await rksOf(tx, key, 0), await rksOf(tx, key, 1));

/** Keeps an uploaded replay, pending until the worker judged it (server/worker.ts). */
export async function addReplay(
  sha256: string,
  key: Uint8Array,
  song: string,
  header: ReplayHeader,
) {
  await db
    .insert(replays)
    .values({
      sha256,
      key,
      song,
      level: header.difficulty,
      score: header.score,
      game: header.game,
      header,
      created: Date.now(),
      mods: header.mods,
    })
    .onConflictDoNothing();
}

/**
 * A replay the worker verified counts: it can become its player's best on the chart, and their RKS follows. Whether
 * it became their best. One played with modifiers only counts on their board, as the player's best with those: it's
 * no record of the game's, so it raises nothing else.
 */
export async function countReplay(
  tx: Tx,
  { sha256, key, song, level }: { sha256: string; key: Uint8Array; song: string; level: string },
  header: ReplayHeader,
) {
  const { score, accuracy, mods } = header;
  const best = { key, song, level, accuracy, sha256, fc: header.bad + header.miss === 0 };
  const played = header.date * 1000;
  if (mods) {
    // with modifiers, a higher total replaces the best with the same ones
    await tx
      .insert(modded)
      .values({ ...best, mods, score: totalOf(score, mods), played, created: Date.now() })
      .onConflictDoUpdate({
        target: [modded.key, modded.song, modded.level, modded.mods],
        set: {
          score: excluded(modded.score),
          accuracy: excluded(modded.accuracy),
          fc: excluded(modded.fc),
          played: excluded(modded.played),
          sha256: excluded(modded.sha256),
          created: excluded(modded.created),
        },
        setWhere: sql`excluded.score > ${modded.score}`,
      });
    return false;
  }
  const raised = await raiseBests(tx, key, [{ ...best, score, played }]);
  await updateRks(tx, key);
  return raised.length > 0;
}

/** Who played a replay and what they got. */
export async function replayInfo(sha256: string): Promise<ReplayInfo | undefined> {
  const [row] = await db
    .select({ replay: replays, player: NAME })
    .from(replays)
    .innerJoin(players, eq(players.key, replays.key))
    .where(eq(replays.sha256, sha256));
  if (!row) return undefined;
  const { header, song, level, status, timing, mods } = row.replay;
  return {
    player: row.player,
    song,
    level,
    status: status as ReplayInfo["status"],
    date: header.date * 1000,
    score: header.score,
    mods,
    total: totalOf(header.score, mods),
    accuracy: header.accuracy,
    timing,
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

// the rows of each board: the bests of a scope, or the ones with modifiers. those read as bests here, as these
// queries only name what both tables have
const BOARDS = [
  { b: bests, scoped: eq(bests.scope, 0) },
  { b: bests, scoped: eq(bests.scope, 1) },
  { b: modded as unknown as typeof bests, scoped: undefined },
];
const listed = eq(players.unlisted, false);

/**
 * A chart's players on a board, best score first and on a tie the earliest verified replay, then the earliest record.
 * With modifiers it's each player's best with each set of them, best total first.
 */
export async function chartPlays(
  board: Board,
  song: string,
  level: string,
  limit: number,
  offset: number,
): Promise<ChartPlays> {
  const { b, scoped } = BOARDS[board]!;
  const on = and(scoped, eq(b.song, song), eq(b.level, level), listed);
  const rows = await db
    .select({
      sha256: b.sha256,
      score: sql<number>`coalesce(${replays.score}, ${b.score})`,
      total: b.score,
      mods: sql<number>`coalesce(${replays.mods}, 0)`,
      accuracy: b.accuracy,
      fc: b.fc,
      played: b.played,
      status: replays.status,
      timing: replays.timing,
      player: NAME,
    })
    .from(b)
    .leftJoin(replays, eq(replays.sha256, b.sha256))
    .innerJoin(players, eq(players.key, b.key))
    .where(on)
    .orderBy(desc(b.score), b.played, b.created)
    .limit(limit)
    .offset(offset);
  const [total] = await db
    .select({ count: count() })
    .from(b)
    .innerJoin(players, eq(players.key, b.key))
    .where(on);
  const plays = rows.map((row, index) => ({
    id: row.sha256 ?? `imported:${row.player.id}`,
    replay: row.sha256,
    rank: offset + index + 1,
    player: row.player,
    score: row.score,
    mods: row.mods,
    total: row.total,
    accuracy: row.accuracy,
    timing: row.timing,
    fc: row.fc,
    status: (row.status ?? "imported") as PlayStatus,
    date: row.played,
  }));
  return { count: total!.count, plays };
}

/** The place a score takes on a chart counting all plays: one past the listed players above it. */
export async function placeOf(tx: Tx, song: string, level: string, score: number) {
  const [{ above }] = await tx
    .select({ above: count() })
    .from(bests)
    .innerJoin(players, eq(players.key, bests.key))
    .where(
      and(
        eq(bests.scope, 0),
        eq(bests.song, song),
        eq(bests.level, level),
        gt(bests.score, score),
        listed,
      ),
    );
  return above + 1;
}

/** Where a player's best stands on a chart counting all plays, undefined if they have none there. */
export async function chartPlace(tx: Tx, key: Uint8Array, song: string, level: string) {
  const [mine] = await tx
    .select({ score: bests.score })
    .from(bests)
    .where(
      and(eq(bests.key, key), eq(bests.song, song), eq(bests.level, level), eq(bests.scope, 0)),
    );
  return mine && placeOf(tx, song, level, mine.score);
}

const RKS = [
  { rks: players.rks, at: players.rks_at },
  { rks: players.rks_verified, at: players.rks_verified_at },
];

/** The listed players with their rank by the scope's RKS, the earliest to reach it first on a tie. */
export function ranked(scope: Scope) {
  const { rks, at } = RKS[scope]!;
  return db
    .select({
      key: players.key,
      fold: players.fold,
      ...NAME,
      rks: sql<number>`${rks}`.as("rks"),
      rank: sql<number>`(row_number() over (order by ${rks} desc, ${at}))::int`.as("rank"),
    })
    .from(players)
    .where(and(gt(rks, 0), listed))
    .as("ranked");
}

/** Players by RKS, those matching a search if there's one: part of the name, then "#0042" for a number. */
export async function playerRanking(
  scope: Scope,
  limit: number,
  offset: number,
  search = "",
): Promise<PlayerRanking> {
  const [name = "", number = ""] = search.trim().split("#");
  const wanted = Number.parseInt(number, 10) || 0;
  const all = ranked(scope);
  const found = and(
    like(all.fold, `%${fold(name).replace(/[\\%_]/g, "\\$&")}%`),
    wanted ? eq(all.number, wanted) : undefined,
  );
  const rows = await db
    .select()
    .from(all)
    .where(found)
    .orderBy(all.rank)
    .limit(limit)
    .offset(offset);
  const [total] = await db.select({ count: count() }).from(all).where(found);
  const listing = rows.map(({ rank, rks, id, name, number, avatar }) => ({
    rank,
    player: { id, name, number, avatar },
    rks,
  }));
  return { count: total!.count, players: listing };
}

const cached: ({ at: number; charts: Promise<ChartCount[]> } | undefined)[] = [];

/** Every chart with a best on the board, most players first. Counted at most once a minute, as it reads every best. */
export function chartCounts(board: Board): Promise<ChartCount[]> {
  const known = cached[board];
  if (known && Date.now() - known.at < 60_000) return known.charts;
  const { b, scoped } = BOARDS[board]!;
  const charts = db
    .select({ song: b.song, level: b.level, count: count() })
    .from(b)
    .innerJoin(players, eq(players.key, b.key))
    .where(and(scoped, listed))
    .groupBy(b.song, b.level)
    .orderBy(desc(count()), b.song, b.level)
    .then((rows) => rows);
  // the answer is kept as it's asked for, so pages loading at once count once. one that failed isn't kept
  cached[board] = { at: Date.now(), charts };
  charts.catch(() => {
    cached[board] = undefined;
  });
  return charts;
}
