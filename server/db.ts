import { SQL } from "bun";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/bun-sql";
import { migrate } from "drizzle-orm/bun-sql/migrator";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { port } from "./sqlite";

// PostgreSQL, through Bun's own client. the tables are in server/schema.ts
const client = new SQL(process.env.DATABASE_URL ?? "postgres://phigros@localhost/phigros");
export const db = drizzle({ client });

/** What runs inside `db.transaction`: every query of it goes through this, never through `db`. */
export type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * Makes the transactions that take the same name wait for each other, in the server and the worker alike. One that
 * reads a player's rows to decide what it writes takes the player's key first.
 */
export async function lock(tx: Tx, name: string | Uint8Array) {
  const text = typeof name === "string" ? name : Buffer.from(name).toString("hex");
  await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${text}, 0))`);
}

/** The value an upsert was about to insert, in what it sets on a conflict. */
export const excluded = (column: AnyPgColumn) => sql.raw(`excluded."${column.name}"`);

// the server and the worker start together: one brings the tables up to date, the other waits for it. migrate
// takes no lock of its own
const boot = await client.reserve();
await boot`select pg_advisory_lock(1)`;
try {
  await migrate(db, { migrationsFolder: "./drizzle" });
  await port(db);
} finally {
  await boot`select pg_advisory_unlock(1)`;
  boot.release();
}
