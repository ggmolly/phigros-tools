import { count, countDistinct, desc, eq, gte, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { getCookie, type H3Event, HTTPError } from "nitro/h3";
import { config } from "./config";
import { db } from "./db";
import * as friends from "./friends";
import * as live from "./live";
import { build, logged } from "./log";
import * as rooms from "./rooms";
import { event_days, events, matches, players, replays } from "./schema";
import { SESSION, sessionPlayer } from "./session";

/*
 * What /admin shows (src/routes/admin.tsx): the pages seen, what the server is doing now, and the logs VictoriaLogs
 * keeps (routes/api/admin). Only the players data/config.toml names as admins get any of it, anyone else a 404 as if
 * there were nothing here.
 */

/** What a player may do beyond their own profile. */
export type Role = "admin";

/** The roles of a profile's key. */
export const rolesOf = (key: Uint8Array): Role[] =>
  config.admins.includes(Buffer.from(key).toString("hex")) ? ["admin"] : [];

/** The signed-in player when they have the role, a 404 otherwise. */
export async function allowed(event: H3Event, role: Role = "admin") {
  const who = await sessionPlayer(getCookie(event, SESSION));
  if (!who || !rolesOf(who.key).includes(role)) throw HTTPError.status(404);
  return who;
}

const DAY = 86_400_000;
const day = (ago: number) => new Date(Date.now() - ago * DAY).toISOString().slice(0, 10);
const human = eq(events.is_bot, false);
const seen = { views: count(), visitors: countDistinct(events.visitor_hash) };

/** The pages seen over the last days: each day's totals, and what was seen most, by whom and from where. */
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
  return {
    days: [...over, { day: day(0), ...today!, bot_views: 0 }],
    pages: await top(events.path),
    referrers: await top(events.referrer_domain),
    countries: await top(events.country),
    browsers: await top(events.browser),
    devices: await top(events.device),
    bots: await top(events.bot_match, true),
  };
}

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
    friends: friends.gauges(),
    live: live.gauges(),
    players: { all: registered!.n, day: active!.n, week: recent!.n },
    matches: played!.n,
    replays: Object.fromEntries(judged.map(({ status, n }) => [status, n])),
  };
}
