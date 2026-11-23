import {
  bigint,
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  unique,
} from "drizzle-orm/pg-core";
import type { ReplayHeader } from "../src/pigeon";

/*
 * Every table of phigros.tools. `bun run generate` writes what changed here to drizzle/ as SQL, which the server and
 * the worker apply when they start (server/db.ts). Columns are named as the database names them.
 */

// a player's or a device's ed25519 public key (32 bytes), read back as a Buffer
const bytes = customType<{ data: Uint8Array; driverData: Buffer }>({ dataType: () => "bytea" });
// drizzle's own jsonb makes a string of the value, which bun then encodes once more
const json = <T>() => customType<{ data: T }>({ dataType: () => "jsonb" })();
// a time in ms, as javascript counts it: the game and the pages are sent these
const ms = () => bigint({ mode: "number" });
const owner = () =>
  bytes()
    .notNull()
    .references(() => players.key);

// a player is a key with the name it has in Phigros and a number the server picks, unique per name. fold is the name
// as compared: case and unicode variants of a name share its numbers. each RKS keeps when it last changed, so the
// earlier player to reach it ranks first
export const players = pgTable(
  "players",
  {
    key: bytes().primaryKey(),
    id: text().notNull().unique(),
    name: text().notNull(),
    fold: text().notNull(),
    number: integer().notNull(),
    intro: text().notNull().default(""),
    avatar: text().notNull().default(""),
    background: text().notNull().default(""),
    unlisted: boolean().notNull().default(false),
    rks: doublePrecision().notNull().default(0),
    rks_at: ms().notNull().default(0),
    rks_verified: doublePrecision().notNull().default(0),
    rks_verified_at: ms().notNull().default(0),
    created: ms().notNull(),
    seen: ms().notNull().default(0),
  },
  (t) => [
    unique().on(t.fold, t.number),
    index().on(t.rks.desc(), t.rks_at),
    index().on(t.rks_verified.desc(), t.rks_verified_at),
  ],
);

// the time of the last request each key signed, which only goes forward (server/auth.ts)
export const keys = pgTable("keys", { key: bytes().primaryKey(), last_time: ms().notNull() });

// a device signed in to a profile with a code (see devices.ts) signs with its own key, which acts as the owner's: the
// key that made the profile, whose recovery phrase always brings it back. a removed device stays, refused
export const devices = pgTable(
  "devices",
  {
    key: bytes().primaryKey(),
    owner: owner(),
    name: text().notNull(),
    added: ms().notNull(),
    removed: ms(),
  },
  (t) => [index().on(t.owner)],
);

// a signed-in device shows a code, another device types it and joins the profile with its own key: only public keys
// ever reach the server. a code works once, for 10 minutes, and a profile has one at a time
export const invites = pgTable("invites", {
  code: text().primaryKey(),
  owner: owner().unique(),
  expires: ms().notNull(),
});

// the names players give their devices, over the model a device was added with
export const labels = pgTable("labels", {
  key: bytes()
    .primaryKey()
    .references(() => devices.key),
  name: text().notNull(),
});

// a player's whole save as their game uploaded it and its summary (CloudSaveSummary, base64), the file itself is in
// data/saves (server/saves.ts). offers are the saves a player sent from the site, that their game offers to load once
const slot = (name: string) =>
  pgTable(name, {
    id: text()
      .primaryKey()
      .references(() => players.id),
    updated: ms().notNull(),
    size: integer().notNull(),
    summary: text(),
  });
export const saves = slot("saves");
export const offers = slot("offers");

const record = {
  key: owner(),
  song: text().notNull(),
  level: text().notNull(),
  score: integer().notNull(),
  accuracy: doublePrecision().notNull(),
  fc: boolean().notNull(),
};

// the records a player's game says it has, sent as they are: nothing proves them, the site shows them as imported
export const imported = pgTable("imported", { ...record, updated: ms().notNull() }, (t) => [
  primaryKey({ columns: [t.key, t.song, t.level] }),
]);

// the records a player typed on the site to rebuild their save (see declareRecords): each sits above their best on
// its chart and counts nowhere, until a play from the game reaches it
export const declared = pgTable("declared", record, (t) => [
  primaryKey({ columns: [t.key, t.song, t.level] }),
]);

// song is the catalog's id, status is pending until the re-simulation verifies the result or finds it unverified
// (with both results). timing is the accuracy of its touches (timingAccuracy), mods the modifiers it was played with
export const replays = pgTable(
  "replays",
  {
    sha256: text().primaryKey(),
    key: owner(),
    song: text().notNull(),
    level: text().notNull(),
    score: integer().notNull(),
    game: integer().notNull(),
    header: json<ReplayHeader>().notNull(),
    status: text().notNull().default("pending"),
    result: json<{ recorded: object; replayed: object }>(),
    created: ms().notNull(),
    timing: doublePrecision(),
    mods: integer().notNull().default(0),
  },
  (t) => [index().on(t.key)],
);

// each player's best on each chart, so a chart's ranking is read in order from the index: a verified replay (sha256),
// or a record their game sent (imported, no sha256, no date). a tie goes to the earliest played replay, then to
// the earliest record (created is when it became the best). the scope is what a leaderboard counts: 0 for all
// (both), 1 for verified replays only
export const bests = pgTable(
  "bests",
  {
    ...record,
    scope: integer().notNull(),
    played: ms(),
    created: ms().notNull(),
    sha256: text().references(() => replays.sha256),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.song, t.level, t.scope] }),
    index().on(t.scope, t.song, t.level, t.score.desc(), t.played, t.created),
  ],
);

// each player's best with each set of modifiers on each chart (src/modifiers.ts), all verified replays: the board of
// plays with modifiers, apart from the bests as those are no records of the game's. score is the total the modifiers
// give it, which the board is ranked by
export const modded = pgTable(
  "modded",
  {
    ...record,
    mods: integer().notNull(),
    played: ms().notNull(),
    created: ms().notNull(),
    sha256: text()
      .notNull()
      .references(() => replays.sha256),
  },
  (t) => [
    primaryKey({ columns: [t.key, t.song, t.level, t.mods] }),
    index().on(t.song, t.level, t.score.desc(), t.played, t.created),
  ],
);

// what a player's page shows besides their bests: every song they finished (a summary sent by the game, no replay),
// the rank each new best took on its chart, and their RKS and rank once a day
export const plays = pgTable(
  "plays",
  {
    key: owner(),
    song: text().notNull(),
    level: text().notNull(),
    score: integer().notNull(),
    accuracy: doublePrecision().notNull(),
    maxcombo: integer().notNull(),
    perfect: integer().notNull(),
    good: integer().notNull(),
    bad: integer().notNull(),
    miss: integer().notNull(),
    duration: doublePrecision().notNull(),
    played: ms().notNull(),
    mods: integer().notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.key, t.played, t.song, t.level] })],
);
export const activity = pgTable(
  "activity",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    key: owner(),
    song: text().notNull(),
    level: text().notNull(),
    score: integer().notNull(),
    rank: integer().notNull(),
    at: ms().notNull(),
  },
  (t) => [index().on(t.key, t.at.desc())],
);
export const history = pgTable(
  "history",
  {
    key: owner(),
    day: date().notNull(),
    rks: doublePrecision().notNull(),
    rank: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.key, t.day] })],
);

// the matches of the rooms without a password (server/rooms.ts), and what each player got in them: place is the
// order they ranked in, so plays that tie keep the order they finished in
export const matches = pgTable(
  "matches",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    room: text().notNull(),
    name: text().notNull(),
    song: text().notNull(),
    level: text().notNull(),
    mods: integer().notNull(),
    played: ms().notNull(),
  },
  (t) => [index().on(t.room, t.played.desc())],
);
export const match_plays = pgTable(
  "match_plays",
  {
    match: integer()
      .notNull()
      .references(() => matches.id, { onDelete: "cascade" }),
    key: owner(),
    place: integer().notNull(),
    score: integer().notNull(),
    accuracy: doublePrecision().notNull(),
    maxcombo: integer().notNull(),
    perfect: integer().notNull(),
    good: integer().notNull(),
    bad: integer().notNull(),
    miss: integer().notNull(),
    level: text().notNull(),
    mods: integer().notNull(),
  },
  (t) => [primaryKey({ columns: [t.match, t.key] })],
);

// a row is a player asking another: they're friends once both asked
export const friends = pgTable(
  "friends",
  { player: owner(), friend: owner(), added: ms().notNull() },
  (t) => [primaryKey({ columns: [t.player, t.friend] }), index().on(t.friend)],
);

// a page seen (routes/api/beacon.post.ts): no address, and a visitor's hash changes every day. only the user agent of
// a bot is kept. they go after 90 days, each day's totals staying in event_days (server/worker.ts)
export const events = pgTable(
  "events",
  {
    id: integer().primaryKey().generatedByDefaultAsIdentity(),
    ts: ms().notNull(),
    day: date().notNull(),
    path: text().notNull(),
    referrer_domain: text(),
    browser: text().notNull(),
    device: text().notNull(),
    is_bot: boolean().notNull().default(false),
    visitor_hash: text().notNull(),
    bot_ua: text(),
    bot_match: text(),
    country: text(),
  },
  (t) => [index().on(t.day), index().on(t.day, t.path), index().on(t.day, t.is_bot)],
);
export const event_days = pgTable("event_days", {
  day: date().primaryKey(),
  views: integer().notNull(),
  visitors: integer().notNull(),
  bot_views: integer().notNull(),
});
