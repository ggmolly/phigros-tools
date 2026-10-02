import { Database } from "bun:sqlite";
import { mkdirSync } from "node:fs";

mkdirSync("./data", { recursive: true });
const sqlite = new Database("./data/db.sqlite3");
sqlite.run("PRAGMA journal_mode = WAL;");
sqlite.run("PRAGMA busy_timeout = 5000;");

sqlite.run(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts INTEGER NOT NULL,
    day TEXT NOT NULL,
    path TEXT NOT NULL,
    referrer_domain TEXT,
    browser TEXT NOT NULL,
    device TEXT NOT NULL,
    is_bot INTEGER NOT NULL DEFAULT 0,
    visitor_hash TEXT NOT NULL,
    bot_ua TEXT,
    bot_match TEXT
  )
`);
const eventColumns = new Set(
  sqlite.query<{ name: string }, []>("PRAGMA table_info(events)").all().map((c) => c.name),
);
if (!eventColumns.has("bot_ua")) sqlite.run("ALTER TABLE events ADD COLUMN bot_ua TEXT");
if (!eventColumns.has("bot_match")) sqlite.run("ALTER TABLE events ADD COLUMN bot_match TEXT");
sqlite.run("CREATE INDEX IF NOT EXISTS idx_events_day ON events(day)");
sqlite.run("CREATE INDEX IF NOT EXISTS idx_events_day_path ON events(day, path)");
sqlite.run("CREATE INDEX IF NOT EXISTS idx_events_day_bot ON events(day, is_bot)");

const insertStmt = sqlite.prepare(`
  INSERT INTO events (ts, day, path, referrer_domain, browser, device, is_bot, visitor_hash, bot_ua, bot_match)
  VALUES ($ts, $day, $path, $referrerDomain, $browser, $device, $isBot, $visitorHash, $botUa, $botMatch)
`);

export function insertEvent(row: {
  ts: number;
  day: string;
  path: string;
  referrerDomain: string | null;
  browser: string;
  device: string;
  isBot: boolean;
  visitorHash: string;
  botUa: string | null;
  botMatch: string | null;
}) {
  insertStmt.run({
    $ts: row.ts,
    $day: row.day,
    $path: row.path,
    $referrerDomain: row.referrerDomain,
    $browser: row.browser,
    $device: row.device,
    $isBot: row.isBot ? 1 : 0,
    $visitorHash: row.visitorHash,
    $botUa: row.botUa,
    $botMatch: row.botMatch,
  });
}
