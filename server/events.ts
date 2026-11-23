import { lt, sql } from "drizzle-orm";
import { db } from "./db";
import { event_days, events } from "./schema";

const KEPT = 90; // days a page seen stays, like the logs

/** Keeps the totals of each day that's over, and forgets the pages seen more than 90 days ago. */
export async function expireEvents() {
  const today = sql`${new Date().toISOString().slice(0, 10)}::date`;
  const human = sql`filter (where not ${events.is_bot})`;
  await db
    .insert(event_days)
    .select(
      db
        .select({
          day: events.day,
          views: sql<number>`(count(*) ${human})::int`.as("views"),
          visitors: sql<number>`(count(distinct ${events.visitor_hash}) ${human})::int`.as(
            "visitors",
          ),
          bot_views: sql<number>`(count(*) filter (where ${events.is_bot}))::int`.as("bot_views"),
        })
        .from(events)
        .where(lt(events.day, today))
        .groupBy(events.day),
    )
    .onConflictDoNothing();
  await db.delete(events).where(lt(events.day, sql`${today} - ${KEPT}::int`));
}
