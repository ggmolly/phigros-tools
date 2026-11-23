import { and, count, desc, eq, gt, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { HTTPError } from "nitro/h3";
import { canonicalSongId, catalogSong } from "../src/catalog";
import { chartRks } from "../src/metrics";
import { totalOf, validMods } from "../src/modifiers";
import { LEVELS, type LevelName } from "../src/modules";
import {
  type Activity,
  LIST_FIRST,
  type Page,
  type PlayedChart,
  type PlayerProfile,
  type PlayStatus,
} from "../src/plays";
import { db, excluded, type Tx } from "./db";
import { keyOf, rolesOf } from "./players";
import { placeOf, ranked } from "./replays";
import * as t from "./schema";

// what a player's page shows besides their bests (the plays, activity and history tables in server/schema.ts)
const MAX_PLAYS = 500;
const MAX_COUNT = 1_000_000; // a note count or a score, far past any chart's
const { activity, bests, declared, history, players, plays, replays } = t;

/**
 * Songs a player finished, one JSON object per line as the game sends them. Sending one again changes nothing. Levels
 * the site doesn't rank (the game's Legacy charts) are skipped, and so are modifiers it doesn't know: the game drops
 * a whole batch that's refused.
 */
export async function addPlays(key: Uint8Array, text: string): Promise<number> {
  const lines = text.split("\n").filter(Boolean);
  if (lines.length > MAX_PLAYS) throw HTTPError.status(413, "Too many plays");
  const sent = lines.flatMap((line) => {
    const p = JSON.parse(line) as Record<string, unknown>;
    const n = (field: string, max = Number.MAX_SAFE_INTEGER) => {
      const value = Number(p[field]);
      if (!Number.isFinite(value) || value < 0 || value > max)
        throw HTTPError.status(400, `Bad ${field}: ${line}`);
      return value;
    };
    const whole = (field: string) => Math.round(n(field, MAX_COUNT));
    const level = String(p.level);
    const mods = Number(p.mods ?? 0);
    if (!LEVELS.includes(level as LevelName) || !validMods(mods, 0)) return [];
    return {
      key,
      mods,
      // PostgreSQL keeps no NUL in a text
      song: canonicalSongId(String(p.song).replaceAll("\0", "").replace(/\.0$/, "")),
      level,
      score: whole("score"),
      accuracy: Math.min(100, n("accuracy")),
      maxcombo: whole("maxcombo"),
      perfect: whole("perfect"),
      good: whole("good"),
      bad: whole("bad"),
      miss: whole("miss"),
      duration: n("duration"),
      played: Math.round(n("date", 1e11) * 1000),
    };
  });
  if (sent.length) await db.insert(plays).values(sent).onConflictDoNothing();
  return sent.length;
}

/** A verified replay became the player's best: the rank it took on its chart goes to their activity. */
export async function addAchievement(
  tx: Tx,
  key: Uint8Array,
  song: string,
  level: string,
  score: number,
) {
  const rank = await placeOf(tx, song, level, score);
  await tx.insert(activity).values({ key, song, level, score, rank, at: Date.now() });
}

/** Keeps today's RKS and rank of every listed player, the last call of a day staying. */
export async function snapshotHistory() {
  await db
    .insert(history)
    .select(
      db
        .select({
          key: players.key,
          day: sql<string>`${new Date().toISOString().slice(0, 10)}::date`.as("day"),
          rks: players.rks,
          rank: sql<number>`(row_number() over (order by ${players.rks} desc, ${players.rks_at}))::int`.as(
            "rank",
          ),
        })
        .from(players)
        .where(and(gt(players.rks, 0), eq(players.unlisted, false))),
    )
    .onConflictDoUpdate({
      target: [history.key, history.day],
      set: { rks: excluded(history.rks), rank: excluded(history.rank) },
    });
}

// one row past the page tells whether there's another
function page<T>(rows: T[], limit: number): Page<T> {
  return { items: rows.slice(0, limit), more: rows.length > limit };
}

// a play shows the verified replay of the same result, when the player uploaded one
const proof = alias(replays, "proof");
const proven = db
  .select({ sha256: proof.sha256 })
  .from(proof)
  .where(
    and(
      eq(proof.key, plays.key),
      eq(proof.song, plays.song),
      eq(proof.level, plays.level),
      eq(proof.score, plays.score),
      eq(proof.mods, plays.mods),
      eq(proof.status, "verified"),
    ),
  )
  .limit(1);

async function recentPlays(
  key: Uint8Array,
  offset: number,
  limit: number,
): Promise<Page<PlayedChart>> {
  const rows = await db
    .select({ play: plays, replay: replays.sha256, timing: replays.timing })
    .from(plays)
    .leftJoin(replays, eq(replays.sha256, sql`(${proven})`))
    .where(eq(plays.key, key))
    .orderBy(desc(plays.played))
    .limit(limit + 1)
    .offset(offset);
  return page(
    rows.map(({ play, replay, timing }) => ({
      song: play.song,
      level: play.level,
      score: play.score,
      mods: play.mods,
      total: totalOf(play.score, play.mods),
      accuracy: play.accuracy,
      timing,
      fc: play.bad + play.miss === 0,
      date: play.played,
      replay,
    })),
    limit,
  );
}

async function activities(key: Uint8Array, offset: number, limit: number): Promise<Page<Activity>> {
  const rows = await db
    .select()
    .from(activity)
    .where(eq(activity.key, key))
    .orderBy(desc(activity.at), desc(activity.id))
    .limit(limit + 1)
    .offset(offset);
  return page(
    rows.map(({ song, level, score, rank, at }) => ({ song, level, score, rank, date: at })),
    limit,
  );
}

const LISTS = { recent: recentPlays, activity: activities };

/** More of a player's recent plays or activity, after the ones already shown. */
export async function profileList(id: string, list: string, offset: number, limit: number) {
  const key = await keyOf(id);
  const read = LISTS[list as keyof typeof LISTS];
  return key && read ? read(key, offset, limit) : undefined;
}

const BEST = 27;
const PHI = 3;

/** A player's page: their card, rank, stats, top and recent plays, activity and RKS history. */
export async function profilePage(id: string): Promise<PlayerProfile | undefined> {
  const [row] = await db.select().from(players).where(eq(players.id, id));
  if (!row) return undefined;
  const played = await db
    .select({ best: bests, status: replays.status, timing: replays.timing })
    .from(bests)
    .leftJoin(replays, eq(replays.sha256, bests.sha256))
    .where(and(eq(bests.key, row.key), eq(bests.scope, 0)))
    .orderBy(bests.song, bests.level);
  const typed = await db
    .select()
    .from(declared)
    .where(eq(declared.key, row.key))
    .orderBy(declared.song, declared.level);
  const top = [
    ...played.map(({ best, status, timing }) => ({ ...best, status, timing })),
    ...typed.map((best) => ({
      ...best,
      played: null,
      sha256: null,
      status: "declared",
      timing: null,
    })),
  ]
    .map((best) => {
      const constant = catalogSong(best.song)?.constants[LEVELS.indexOf(best.level as LevelName)];
      return {
        song: best.song,
        level: best.level,
        score: best.score,
        mods: 0,
        total: best.score,
        accuracy: best.accuracy,
        timing: best.timing,
        fc: best.fc,
        date: best.played,
        replay: best.sha256,
        status: (best.status ?? "imported") as PlayStatus,
        rks: constant == null ? 0 : chartRks(best.accuracy, constant),
        counted: false,
      };
    })
    .sort((a, b) => b.rks - a.rks);
  // declared records are listed with the bests and count for nothing
  const counting = top.filter((best) => best.status !== "declared");
  // counted like the game's RKS: the 27 best charts, and the 3 best of those with 100% accuracy
  for (const best of counting.slice(0, BEST)) best.counted = true;
  for (const best of counting.filter((b) => b.accuracy >= 100).slice(0, PHI)) best.counted = true;
  const all = ranked(0);
  const [place] = row.unlisted
    ? []
    : await db.select({ rank: all.rank }).from(all).where(eq(all.key, row.key));
  const rank = place?.rank ?? null;
  // the worker keeps a day hourly (snapshotHistory), today's point follows the RKS shown above it
  const days = await db
    .select({ day: history.day, rks: history.rks, rank: history.rank })
    .from(history)
    .where(eq(history.key, row.key))
    .orderBy(desc(history.day))
    .limit(365);
  days.reverse();
  const today = new Date().toISOString().slice(0, 10);
  if (rank !== null && row.rks > 0) {
    if (days.at(-1)?.day === today) days.pop();
    days.push({ day: today, rks: row.rks, rank });
  }
  const [totals] = await db
    .select({
      plays: count(),
      notes: sql<number>`coalesce(sum(${plays.perfect} + ${plays.good} + ${plays.bad}), 0)::float8`,
      accuracy: sql<number | null>`avg(${plays.accuracy})`,
      maxcombo: sql<number>`coalesce(max(${plays.maxcombo}), 0)`,
    })
    .from(plays)
    .where(eq(plays.key, row.key));
  return {
    player: { id: row.id, name: row.name, number: row.number, avatar: row.avatar },
    roles: rolesOf(row.key),
    intro: row.intro,
    background: row.background,
    rks: row.rks,
    rank,
    joined: row.created,
    seen: Math.max(row.seen, row.created),
    stats: {
      ...totals!,
      cleared: counting.length,
      fc: counting.filter((best) => best.fc).length,
      phi: counting.filter((best) => best.score >= 1_000_000).length,
    },
    top,
    recent: await recentPlays(row.key, 0, LIST_FIRST),
    activity: await activities(row.key, 0, LIST_FIRST),
    history: days,
  };
}
