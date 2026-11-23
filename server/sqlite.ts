import { Database } from "bun:sqlite";
import { existsSync } from "node:fs";
import { count, getTableColumns, getTableName, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import type { db as database } from "./db";
import { log } from "./log";
import * as t from "./schema";

/*
 * phigros.tools kept everything in data/db.sqlite3 before PostgreSQL. The first start on an empty PostgreSQL copies
 * it over whole, in one transaction: either all of it is there or the server doesn't start. The file is only read, so
 * the build before this one still runs on it. This file goes once phigros.tools has started on PostgreSQL.
 */
const FILE = "./data/db.sqlite3";
// a row whose player or replay is gone showed nowhere: it stays behind, and the log says how many did
const OWNED = "key IN (SELECT key FROM players)";
const PROVEN = `${OWNED} AND (sha256 IS NULL OR sha256 IN (SELECT sha256 FROM replays WHERE ${OWNED}))`;
const all = (name: string, where = "1") => `SELECT * FROM ${name} WHERE ${where}`;

// in the order their references need. invites live 10 minutes: none is worth copying
const TABLES: [PgTable, string][] = [
  [t.players, all("players")],
  [t.keys, all("keys")],
  [t.devices, all("devices", "owner IN (SELECT key FROM players)")],
  [
    t.labels,
    all("labels", "key IN (SELECT key FROM devices WHERE owner IN (SELECT key FROM players))"),
  ],
  [t.saves, all("saves", "id IN (SELECT id FROM players)")],
  [t.offers, all("offers", "id IN (SELECT id FROM players)")],
  [t.imported, all("imported", OWNED)],
  [t.declared, all("declared", OWNED)],
  [t.replays, all("replays", OWNED)],
  [t.bests, all("bests", PROVEN)],
  [t.modded, all("modded", PROVEN)],
  [t.plays, all("plays", OWNED)],
  [t.activity, `SELECT rowid AS id, * FROM activity WHERE ${OWNED}`],
  [t.history, all("history", OWNED)],
  [t.matches, all("matches")],
  // rows were inserted best first, and those from before players picked were played as the match was
  [
    t.match_plays,
    `SELECT mp.match, mp.key, mp.score, mp.accuracy, mp.maxcombo, mp.perfect, mp.good, mp.bad, mp.miss,
       ROW_NUMBER() OVER (PARTITION BY mp.match ORDER BY mp.rowid) AS place,
       COALESCE(mp.level, m.level) AS level, COALESCE(mp.mods, m.mods) AS mods
     FROM match_plays mp JOIN matches m ON m.id = mp.match WHERE mp.key IN (SELECT key FROM players)`,
  ],
  [
    t.friends,
    all("friends", "player IN (SELECT key FROM players) AND friend IN (SELECT key FROM players)"),
  ],
  [t.events, all("events")],
];
const ROOTS = [t.players, t.keys, t.matches, t.events];
const COUNTED = [t.matches, t.activity, t.events]; // their ids are counted on by PostgreSQL from now on

// SQLite has no booleans, kept JSON as text, and took any number in an integer column
function converter(table: PgTable) {
  const columns = Object.entries(getTableColumns(table)).map(
    ([name, column]) => [name, column.getSQLType()] as const,
  );
  return (row: Record<string, unknown>) =>
    Object.fromEntries(
      columns.map(([name, type]) => {
        const value = row[name];
        // a column added since isn't in the file, and takes its default
        if (value == null) return [name, value];
        if (type === "boolean") return [name, value === 1];
        if (type === "jsonb") return [name, JSON.parse(value as string)];
        if (type === "integer" || type === "bigint") return [name, Math.round(value as number)];
        return [name, value];
      }),
    );
}

export async function port(db: typeof database) {
  if (!existsSync(FILE)) return;
  for (const table of ROOTS) if ((await db.select().from(table).limit(1)).length) return;
  const sqlite = new Database(FILE, { readonly: true });
  // SQLite got each table the first time the part of the server using it ran: one never used isn't there
  const read = <Row>(query: string) => {
    try {
      return sqlite.query<Row, []>(query).all();
    } catch (error) {
      if (/no such table/.test(String(error))) return [];
      throw error;
    }
  };
  await db.transaction(async (tx) => {
    for (const [table, select] of TABLES) {
      const name = getTableName(table);
      const rows = read<Record<string, unknown>>(select).map(converter(table));
      for (let at = 0; at < rows.length; at += 1000)
        await tx.insert(table).values(rows.slice(at, at + 1000));
      const [copied] = await tx.select({ rows: count() }).from(table);
      if (copied!.rows !== rows.length)
        throw new Error(`${name}: ${copied!.rows} of ${rows.length}`);
      const had = read<{ had: number }>(`SELECT COUNT(*) AS had FROM ${name}`)[0]?.had ?? 0;
      log.info("port", { table: name, rows: rows.length, left: had - rows.length });
    }
    for (const table of COUNTED)
      await tx.execute(
        sql`select setval(pg_get_serial_sequence(${getTableName(table)}, 'id'), coalesce(max(id), 1), max(id) is not null) from ${table}`,
      );
  });
  sqlite.close();
}
