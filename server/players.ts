import { HTTPError } from "nitro/h3";
import type { PlayerName } from "../src/plays";
import { sqlite } from "./db";

// a player is a key with the name it has in Phigros and a number the server picks, unique per name. fold is the name
// as compared: case and unicode variants of a name share its numbers
sqlite.run(`
  CREATE TABLE IF NOT EXISTS players (
    key BLOB PRIMARY KEY,
    id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    fold TEXT NOT NULL,
    number INTEGER NOT NULL,
    intro TEXT NOT NULL DEFAULT '',
    avatar TEXT NOT NULL DEFAULT '',
    background TEXT NOT NULL DEFAULT '',
    unlisted INTEGER NOT NULL DEFAULT 0,
    rks REAL NOT NULL DEFAULT 0,
    rks_at INTEGER NOT NULL DEFAULT 0,
    rks_verified REAL NOT NULL DEFAULT 0,
    rks_verified_at INTEGER NOT NULL DEFAULT 0,
    created INTEGER NOT NULL,
    UNIQUE (fold, number)
  )
`);
sqlite.run("CREATE INDEX IF NOT EXISTS idx_players_rank ON players(rks DESC, rks_at)");
sqlite.run(
  "CREATE INDEX IF NOT EXISTS idx_players_rank_verified ON players(rks_verified DESC, rks_verified_at)",
);

const NUMBERS = 9999;
const NAME_LENGTH = 32;
const INTRO_LENGTH = 500;

/** The first 12 hex characters of the key: the player's id in URLs. */
export const playerId = (key: Uint8Array) => Buffer.from(key.subarray(0, 6)).toString("hex");

// spaces (line breaks too) collapse to one, then the other unicode "other" characters (controls, bidi overrides,
// zero widths) are dropped
function clean(name: string): string {
  const cleaned = name.normalize("NFC").replace(/\s+/gu, " ").replace(/\p{C}/gu, "").trim();
  return [...cleaned].slice(0, NAME_LENGTH).join("");
}
export const fold = (name: string) => name.normalize("NFKC").toLowerCase();

// line breaks stay (at most two in a row), the other unicode "other" characters go
function cleanIntro(intro: string): string {
  const cleaned = intro
    .normalize("NFC")
    .replace(/\r\n?/g, "\n")
    .replace(/[^\P{C}\n]/gu, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return [...cleaned].slice(0, INTRO_LENGTH).join("");
}

const byKey = sqlite.prepare<PlayerName & { fold: string }, [Uint8Array]>(
  "SELECT id, name, number, avatar, fold FROM players WHERE key = ?",
);
const taken = sqlite.prepare<{ number: number }, [string]>(
  "SELECT number FROM players WHERE fold = ?",
);
const create = sqlite.prepare<unknown, [Uint8Array, string, string, string, number, number]>(
  "INSERT INTO players (key, id, name, fold, number, created) VALUES (?, ?, ?, ?, ?, ?)",
);
const rename = sqlite.prepare<unknown, [string, string, number, Uint8Array]>(
  "UPDATE players SET name = ?, fold = ?, number = ? WHERE key = ?",
);
const idTaken = sqlite.prepare<{ key: Uint8Array }, [string]>(
  "SELECT key FROM players WHERE id = ?",
);

export function player(key: Uint8Array): PlayerName | undefined {
  const row = byKey.get(key);
  return row && { id: row.id, name: row.name, number: row.number, avatar: row.avatar };
}

/**
 * Registers the key under its Phigros name, or follows a rename. The number is kept when it's free for the new name,
 * otherwise a random free one: the client never chooses it. "GUEST" is the name of a guest who never set one.
 */
export function setName(key: Uint8Array, raw: string): PlayerName {
  const name = clean(raw);
  if (!name || name === "GUEST") throw new HTTPError({ status: 400, body: { code: "no-name" } });
  return sqlite.transaction(() => {
    const current = byKey.get(key);
    const folded = fold(name);
    if (current?.name === name) return player(key)!;
    const used = new Set(taken.all(folded).map((row) => row.number));
    if (current?.fold === folded) used.delete(current.number);
    let number = current && !used.has(current.number) ? current.number : 0;
    if (!number) {
      const free = Array.from({ length: NUMBERS }, (_, i) => i + 1).filter((n) => !used.has(n));
      if (!free.length) throw new HTTPError({ status: 409, body: { code: "name-full" } });
      number = free[Math.floor(Math.random() * free.length)]!;
    }
    if (current) rename.run(name, folded, number, key);
    else {
      if (idTaken.get(playerId(key)))
        throw new HTTPError({ status: 409, body: { code: "id-taken" } });
      create.run(key, playerId(key), name, folded, number, Date.now());
    }
    return player(key)!;
  })();
}

const updateLook = sqlite.prepare<unknown, [string, string, string, number, Uint8Array]>(
  "UPDATE players SET intro = ?, avatar = ?, background = ?, unlisted = ? WHERE key = ?",
);

/**
 * What the player shows on their Phigros profile: their self-introduction ("" when they kept the game's placeholder or
 * don't share it), avatar and background (the game's keys, "" for its defaults), and whether they're left out of the
 * leaderboards (their page still opens from its link).
 */
export function setLook(
  key: Uint8Array,
  look: { intro: string; avatar: string; background: string; unlisted: boolean },
) {
  const short = (value: string) => clean(value).slice(0, 128);
  updateLook.run(
    cleanIntro(look.intro),
    short(look.avatar),
    short(look.background),
    look.unlisted ? 1 : 0,
    key,
  );
}

// each RKS keeps when it last changed, so the earlier player to reach it ranks first
const updateRks = sqlite.prepare<unknown, [number, number, Uint8Array]>(
  `UPDATE players SET rks_at = CASE WHEN rks != ?1 THEN ?2 ELSE rks_at END, rks = ?1 WHERE key = ?3`,
);
const updateVerifiedRks = sqlite.prepare<unknown, [number, number, Uint8Array]>(
  `UPDATE players SET rks_verified_at = CASE WHEN rks_verified != ?1 THEN ?2 ELSE rks_verified_at END,
   rks_verified = ?1 WHERE key = ?3`,
);

/** The player's RKS counting all their bests, and counting verified replays only. */
export function setRks(key: Uint8Array, rks: number, verified: number) {
  const now = Date.now();
  updateRks.run(rks, now, key);
  updateVerifiedRks.run(verified, now, key);
}
