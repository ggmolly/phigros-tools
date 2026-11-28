import { readdir, stat, statfs } from "node:fs/promises";
import {
  and,
  count,
  countDistinct,
  desc,
  eq,
  gte,
  inArray,
  like,
  or,
  type SQL,
  sql,
} from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getCookie, type H3Event, HTTPError } from "nitro/h3";
import type { Role } from "../src/roles";
import { db } from "./db";
import * as friends from "./friends";
import * as live from "./live";
import { build, log, logged } from "./log";
import { github, MODS_DIR } from "./mods";
import { fold, rolesOf } from "./players";
import { CATALOG_QUEUE, openQueue, queueCatalog, queueVerify, VERIFY_QUEUE } from "./queue";
import { REPLAY_DIR } from "./replays";
import * as rooms from "./rooms";
import { devices, event_days, events, labels, matches, players, replays, saves } from "./schema";
import { SESSION, sessionPlayer } from "./session";

/*
 * What /admin shows (src/routes/admin.tsx): the pages seen, who plays and what, what the server is doing and holds
 * now, the players and replays an admin looks up, and the logs VictoriaLogs keeps (routes/api/admin). Only the players
 * data/config.toml names as admins get any of it, anyone else a 404 as if there were nothing here.
 */

/** Whether the signed-in player has the role. */
export async function holds(event: H3Event, role: Role = "admin") {
  const who = await sessionPlayer(getCookie(event, SESSION));
  return who && rolesOf(who.key).includes(role) ? who : undefined;
}

/** The signed-in player when they have the role, a 404 otherwise. */
export async function allowed(event: H3Event, role: Role = "admin") {
  const who = await holds(event, role);
  if (!who) throw HTTPError.status(404);
  return who;
}

const DAY = 86_400_000;
const day = (ago: number) => new Date(Date.now() - ago * DAY).toISOString().slice(0, 10);
const human = eq(events.is_bot, false);
const seen = { views: count(), visitors: countDistinct(events.visitor_hash) };
// the rows of a query written as sql, where counts read better than through drizzle's builder
const rows = async <T>(query: SQL) => [...(await db.execute(query))] as T[];
// the utc day of a column holding a time in ms
const dayOf = (column: string) =>
  sql.raw(`to_char(to_timestamp(${column} / 1000.0) at time zone 'utc', 'YYYY-MM-DD')`);

/** A row for each of the last days, `zero` for those a query found nothing on. */
function daily<T extends { day: string }>(days: number, found: T[], zero: Omit<T, "day">) {
  return Array.from({ length: days }, (_, at) => {
    const name = day(days - 1 - at);
    return found.find((row) => row.day === name) ?? ({ day: name, ...zero } as T);
  });
}
// the pages gone through on the way to playing Phigros++, in order
const WAY = ["/", "/phigrospp", "/start", "/rebuild"];
const INSTALLER = "ggmolly/PhigrosPlusPlus-Installer";

/** How many times the installer was downloaded, all its releases together, as GitHub counts them. */
async function downloads() {
  const releases: { assets: { download_count: number }[] }[] = JSON.parse(
    await github(`${INSTALLER}/releases?per_page=100`),
  );
  return releases.flatMap(({ assets }) => assets).reduce((sum, a) => sum + a.download_count, 0);
}

/**
 * The pages seen over the last days: each day's totals, what was seen most, by whom and from where, and how far
 * visitors went on the way to Phigros++, a page of questions counted once per answer (its address carries them).
 */
export async function traffic(days: number) {
  const since = gte(events.day, day(days - 1));
  // the most seen values of a column, among people or among bots
  const top = (column: AnyPgColumn, bots = false) =>
    db
      .select({ name: sql<string>`coalesce(${column}, '')`, ...seen })
      .from(events)
      .where(sql`${since} and ${events.is_bot} = ${bots}`)
      .groupBy(column)
      .orderBy(desc(count()))
      .limit(20);
  // the days that are over have their totals kept (server/events.ts), today's are counted as they are now
  const over = await db
    .select()
    .from(event_days)
    .where(gte(event_days.day, day(days - 1)))
    .orderBy(event_days.day);
  const [today] = await db
    .select({ ...seen })
    .from(events)
    .where(sql`${eq(events.day, day(0))} and ${human}`);
  const page = sql<string>`split_part(${events.path}, '?', 1)`;
  const way = await db
    .select({ name: events.path, ...seen })
    .from(events)
    .where(sql`${since} and ${human} and ${inArray(page, WAY)}`)
    .groupBy(events.path)
    .orderBy(events.path);
  const at = (path: string) => WAY.indexOf(path.split("?")[0]!);
  const [made] = await db
    .select({ n: count() })
    .from(players)
    .where(gte(players.created, Date.parse(day(days - 1))));
  const start = day(days - 1);
  // a visit is a visitor's day: how many pages it saw and the one it began on
  const visits = sql`select count(*) n, (array_agg(path order by ts))[1] entry from events
    where day >= ${start}::date and not is_bot group by visitor_hash`;
  const hour = (part: string) =>
    sql.raw(`extract(${part} from to_timestamp(ts / 1000.0) at time zone 'utc')::int`);
  return {
    days: [...over, { day: day(0), ...today!, bot_views: 0 }],
    pages: await top(events.path),
    referrers: await top(events.referrer_domain),
    countries: await top(events.country),
    browsers: await top(events.browser),
    devices: await top(events.device),
    bots: await top(events.bot_match, true),
    way: way.sort((a, b) => at(a.name) - at(b.name)),
    profiles: made!.n,
    downloads: await downloads().catch(() => null),
    entries: await rows<{ name: string; visits: number; alone: number }>(
      sql`select entry name, count(*)::int visits, (count(*) filter (where n = 1))::int alone
        from (${visits}) v group by entry order by visits desc limit 20`,
    ),
    // how many pages a visit saw, those of 10 and more together
    depth: await rows<{ pages: number; visits: number }>(
      sql`select least(n, 10)::int pages, count(*)::int visits from (${visits}) v group by 1 order by 1`,
    ),
    // where the home page led, an empty name for a visit that ended on it
    after: await rows<{ name: string; views: number }>(
      sql`select coalesce(next, '') name, count(*)::int views from (
          select path, lead(path) over (partition by visitor_hash order by ts) next from events
          where day >= ${start}::date and not is_bot
        ) e where path = '/' and next is distinct from '/' group by next order by views desc limit 12`,
    ),
    // the pages seen in each hour of the week, utc: dow 0 is sunday
    hours: await rows<{ dow: number; hour: number; views: number }>(
      sql`select ${hour("dow")} as dow, ${hour("hour")} as hour, count(*)::int as views from events
        where day >= ${start}::date and not is_bot group by 1, 2`,
    ),
  };
}

/** Who registered and who came back over the last days, and what profiles went on to do. */
export async function people(days: number) {
  const from = Date.parse(day(days - 1));
  const now = Date.now();
  const [totals] = await rows<Record<string, number>>(
    sql`select count(*)::int registered,
        (count(*) filter (where seen >= ${now - DAY}))::int as day,
        (count(*) filter (where seen >= ${now - 7 * DAY}))::int as week,
        (count(*) filter (where seen >= ${now - 30 * DAY}))::int as month,
        (count(*) filter (where unlisted))::int unlisted,
        (select count(*) from devices where removed is null)::int devices,
        (select count(*) from friends a join friends b on a.player = b.friend and a.friend = b.player
          where a.player < a.friend)::int friendships,
        (select count(*) from friends a where not exists (
          select 1 from friends b where b.player = a.friend and b.friend = a.player))::int asked
      from players`,
  );
  // a profile's days with a play and its last one. kept is counted among the profiles a week old
  const [after] = await rows<Record<string, number>>(
    sql`select count(*)::int made,
        (count(*) filter (where exists (select 1 from saves where saves.id = players.id)))::int saved,
        (count(*) filter (where exists (
          select 1 from devices where owner = players.key and removed is null)))::int joined,
        (count(*) filter (where p.days >= 1))::int played,
        (count(*) filter (where p.days >= 2))::int again,
        (count(*) filter (where created <= ${now - 7 * DAY}))::int old,
        (count(*) filter (where created <= ${now - 7 * DAY} and p.last >= created + ${7 * DAY}))::int kept
      from players left join (
        select key, count(distinct played / ${DAY}) days, max(played) last from plays group by key
      ) p using (key)`,
  );
  return {
    totals: totals!,
    after: after!,
    made: daily(
      days,
      await rows<{ day: string; n: number }>(
        sql`select ${dayOf("created")} as day, count(*)::int n from players where created >= ${from} group by 1`,
      ),
      { n: 0 },
    ),
    active: daily(
      days,
      await rows<{ day: string; n: number }>(
        sql`select ${dayOf("played")} as day, count(distinct key)::int n from plays
          where played >= ${from} group by 1`,
      ),
      { n: 0 },
    ),
    // how many players have each whole RKS
    rks: await rows<{ rks: number; n: number }>(
      sql`select floor(rks)::int rks, count(*)::int n from players where rks > 0 group by 1 order by 1`,
    ),
    list: await rows<{
      id: string;
      name: string;
      number: number;
      rks: number;
      created: number;
      seen: number;
      unlisted: boolean;
      devices: number;
      plays: number;
      replays: number;
    }>(
      sql`select id, name, number, rks, created::float, seen::float, unlisted,
          (select count(*) from devices where owner = players.key and removed is null)::int devices,
          (select count(*) from plays where plays.key = players.key)::int plays,
          (select count(*) from replays where replays.key = players.key)::int replays
        from players order by seen desc limit 50`,
    ),
  };
}

/** What was played over the last days: the songs finished, the replays sent and how they were judged, the matches. */
export async function played(days: number) {
  const from = Date.parse(day(days - 1));
  const [totals] = await rows<Record<string, number>>(
    sql`select count(*)::int plays, coalesce(sum(duration), 0)::float / 3600 hours,
        coalesce(sum(perfect + good), 0)::float notes, coalesce(avg(accuracy), 0)::float accuracy,
        (select count(*) from matches where played >= ${from})::int matches,
        (select count(*) from match_plays join matches on matches.id = match
          where matches.played >= ${from})::int seats
      from plays where played >= ${from}`,
  );
  const named = (table: string, column: string, time: string) =>
    rows<{ name: string; n: number }>(
      sql`select ${sql.raw(column)}::text name, count(*)::int n from ${sql.raw(table)}
        where ${sql.raw(time)} >= ${from} group by 1 order by n desc`,
    );
  return {
    totals: totals!,
    days: daily(
      days,
      await rows<{ day: string; plays: number; players: number; hours: number }>(
        sql`select ${dayOf("played")} as day, count(*)::int plays, count(distinct key)::int players,
            sum(duration)::float / 3600 hours from plays where played >= ${from} group by 1`,
      ),
      { plays: 0, players: 0, hours: 0 },
    ),
    replays: daily(
      days,
      await rows<{ day: string; n: number; verified: number }>(
        sql`select ${dayOf("created")} as day, count(*)::int n,
            (count(*) filter (where status = 'verified'))::int verified
          from replays where created >= ${from} group by 1`,
      ),
      { n: 0, verified: 0 },
    ),
    levels: await named("plays", "level", "played"),
    // by the modifiers' bits (src/modifiers.ts), 0 for a play without any
    mods: await named("plays", "mods", "played"),
    statuses: await named("replays", "status", "created"),
    games: await named("replays", "game", "created"),
    // by whole percent, everything under 90 together
    accuracy: await rows<{ accuracy: number; n: number }>(
      sql`select greatest(89, floor(accuracy))::int accuracy, count(*)::int n from plays
        where played >= ${from} group by 1 order by 1`,
    ),
    charts: await rows<{ song: string; level: string; plays: number; players: number }>(
      sql`select song, level, count(*)::int plays, count(distinct key)::int players from plays
        where played >= ${from} group by 1, 2 order by plays desc limit 20`,
    ),
    unverified: await rows<{
      sha256: string;
      player: string;
      song: string;
      level: string;
      score: number;
      created: number;
    }>(
      sql`select sha256, (select id from players where key = replays.key) player, song, level, score,
          created::float from replays where status = 'unverified' order by created desc limit 20`,
    ),
  };
}

/** How many files a folder holds, folders inside it too, and their bytes together. */
async function folder(name: string) {
  let bytes = 0;
  let files = 0;
  for (const entry of await readdir(name, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue;
    bytes += (await stat(`${entry.parentPath}/${entry.name}`)).size;
    files++;
  }
  return { name, bytes, files };
}

/** What the server keeps and where: each table, the folders of files, the disk they're on, and the queues' waits. */
export async function storage() {
  const disk = await statfs("./data");
  const queue = await openQueue().catch(() => undefined);
  return {
    tables: await rows<{ name: string; bytes: number; rows: number }>(
      sql`select relname name, pg_total_relation_size(oid)::float bytes, greatest(reltuples, 0)::float rows
        from pg_class where relkind = 'r' and relnamespace = 'public'::regnamespace order by bytes desc`,
    ),
    folders: await Promise.all(["./data/saves", REPLAY_DIR, MODS_DIR].map(folder)),
    disk: { free: disk.bavail * disk.bsize, size: disk.blocks * disk.bsize },
    queues:
      queue &&
      (await Promise.all(
        [VERIFY_QUEUE, CATALOG_QUEUE].map(async (name) => ({
          name,
          waiting: (await queue.checkQueue(name)).messageCount,
        })),
      )),
  };
}

/** The players a name, a `Name#0042` or an id finds, with what the server holds of each. */
export async function found(typed: string) {
  const [name = "", number] = typed.trim().split("#");
  if (!name) return [];
  const matched = await db
    .select()
    .from(players)
    .where(
      or(
        eq(players.id, name),
        number
          ? and(eq(players.fold, fold(name)), eq(players.number, Number(number)))
          : like(players.fold, `${fold(name)}%`),
      ),
    )
    .orderBy(desc(players.seen))
    .limit(10);
  return Promise.all(
    matched.map(async ({ key, fold: _, avatar, background, intro, ...player }) => {
      const [counts] = await rows<Record<string, number>>(
        sql`select (select count(*) from plays where key = ${key})::int plays,
            (select count(*) from replays where key = ${key} and status = 'verified')::int verified,
            (select count(*) from replays where key = ${key} and status = 'unverified')::int unverified,
            (select count(*) from replays where key = ${key} and status = 'pending')::int pending,
            (select count(*) from friends where player = ${key})::int friends`,
      );
      const [save] = await db
        .select({ updated: saves.updated, size: saves.size })
        .from(saves)
        .where(eq(saves.id, player.id));
      return {
        ...player,
        key: Buffer.from(key).toString("hex"),
        roles: rolesOf(key),
        counts: counts!,
        save,
        devices: await db
          .select({
            name: sql<string>`coalesce(${labels.name}, ${devices.name})`,
            added: devices.added,
            removed: devices.removed,
          })
          .from(devices)
          .leftJoin(labels, eq(labels.key, devices.key))
          .where(eq(devices.owner, key))
          .orderBy(devices.added),
      };
    }),
  );
}

/** A replay by its sha256 or its page's address, with how it was judged, null for none. */
export async function replayOf(typed: string) {
  const sha256 = typed.trim().split("/").pop() ?? "";
  const [replay] = await db
    .select({
      sha256: replays.sha256,
      player: players.id,
      song: replays.song,
      level: replays.level,
      score: replays.score,
      game: replays.game,
      mods: replays.mods,
      status: replays.status,
      result: replays.result,
      timing: replays.timing,
      created: replays.created,
    })
    .from(replays)
    .innerJoin(players, eq(players.key, replays.key))
    .where(eq(replays.sha256, sha256));
  return replay ?? null;
}

type Asked = Record<string, unknown>;
// the days a query asks for, as many as the pages seen are kept
const span = (query: Asked) => Math.min(90, Math.max(1, Math.floor(Number(query.days)) || 30));

/** What /admin asks for by name (routes/api/admin/[what].get.ts), each from the query of its address. */
export const ASKED = {
  state,
  storage,
  traffic: (query: Asked) => traffic(span(query)),
  players: (query: Asked) => people(span(query)),
  game: (query: Asked) => played(span(query)),
  player: (query: Asked) => found(String(query.q ?? "")),
  replay: (query: Asked) => replayOf(String(query.q ?? "")),
};

/** What an admin does from /admin (routes/api/admin/[what].post.ts), each with the text sent and logged with who. */
export const DONE = {
  // an unverified replay is judged again, as after a fix of the judge: a verified one already counts
  async judge(sha256: string) {
    const [again] = await db
      .update(replays)
      .set({ status: "pending", result: null })
      .where(and(eq(replays.sha256, sha256), eq(replays.status, "unverified")))
      .returning({ sha256: replays.sha256 });
    if (!again) throw HTTPError.status(404);
    await queueVerify(sha256);
  },
  catalog: queueCatalog,
};
export const did = (who: { id: string }, what: string, text: string) =>
  log.info(`admin.${what}`, { player: who.id, text });

/** What the server holds right now, and how much the database does. */
export async function state() {
  const [[registered], [active], [recent], [played], judged] = await Promise.all([
    db.select({ n: count() }).from(players),
    db
      .select({ n: count() })
      .from(players)
      .where(gte(players.seen, Date.now() - DAY)),
    db
      .select({ n: count() })
      .from(players)
      .where(gte(players.seen, Date.now() - 7 * DAY)),
    db.select({ n: count() }).from(matches),
    db.select({ status: replays.status, n: count() }).from(replays).groupBy(replays.status),
  ]);
  return {
    build,
    uptime: Math.round(process.uptime()),
    memory: process.memoryUsage.rss(),
    log: logged(),
    rooms: rooms.gauges(),
    open: rooms.openRooms(),
    friends: friends.gauges(),
    live: live.gauges(),
    players: { all: registered!.n, day: active!.n, week: recent!.n },
    matches: played!.n,
    replays: Object.fromEntries(judged.map(({ status, n }) => [status, n])),
  };
}
