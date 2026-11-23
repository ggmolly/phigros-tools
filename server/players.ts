import { eq, sql } from "drizzle-orm";
import { HTTPError } from "nitro/h3";
import type { PlayerName } from "../src/plays";
import { db, lock, type Tx } from "./db";
import * as t from "./schema";

/** The player was just online: any request their game signed says so. */
export async function markSeen(key: Uint8Array) {
  await db.update(t.players).set({ seen: Date.now() }).where(eq(t.players.key, key));
}

const NUMBERS = 9999;
const NAME_LENGTH = 32;
const INTRO_LENGTH = 500;

/** The first 12 hex characters of the key: the player's id in URLs. */
export const playerId = (key: Uint8Array) => Buffer.from(key.subarray(0, 6)).toString("hex");

// spaces (line breaks too) collapse to one, then the other unicode "other" characters (controls, bidi overrides,
// zero widths) are dropped. curly quotes become straight, the game's font draws them as wide as a CJK character
export function clean(name: string, length = NAME_LENGTH): string {
  const cleaned = name
    .normalize("NFC")
    .replace(/\s+/gu, " ")
    .replace(/\p{C}/gu, "")
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .trim();
  return [...cleaned].slice(0, length).join("");
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

/** A player as every list names them. */
export const NAME = {
  id: t.players.id,
  name: t.players.name,
  number: t.players.number,
  avatar: t.players.avatar,
};

/** The key of a player's id, undefined for no such player. */
export async function keyOf(id: string) {
  const [found] = await db
    .select({ key: t.players.key })
    .from(t.players)
    .where(eq(t.players.id, id));
  return found?.key;
}

export async function player(key: Uint8Array): Promise<PlayerName | undefined> {
  const [found] = await db.select(NAME).from(t.players).where(eq(t.players.key, key));
  return found;
}

/**
 * Registers the key under its Phigros name, or follows a rename. The number is kept when it's free for the new name,
 * otherwise a random free one: the client never chooses it. "GUEST" is the name of a guest who never set one.
 */
export async function setName(key: Uint8Array, raw: string): Promise<PlayerName> {
  const name = clean(raw);
  if (!name || name === "GUEST") throw new HTTPError({ status: 400, body: { code: "no-name" } });
  const folded = fold(name);
  return db.transaction(async (tx) => {
    // two keys taking a name at once wait here, so each draws a number the other didn't
    await lock(tx, key);
    await lock(tx, `name:${folded}`);
    const [current] = await tx
      .select({ ...NAME, fold: t.players.fold })
      .from(t.players)
      .where(eq(t.players.key, key));
    const id = current?.id ?? playerId(key);
    const avatar = current?.avatar ?? "";
    if (current?.name === name) return { id, name, number: current.number, avatar };
    const taken = await tx
      .select({ number: t.players.number })
      .from(t.players)
      .where(eq(t.players.fold, folded));
    const used = new Set(taken.map((row) => row.number));
    if (current?.fold === folded) used.delete(current.number);
    let number = current && !used.has(current.number) ? current.number : 0;
    if (!number) {
      const free = Array.from({ length: NUMBERS }, (_, i) => i + 1).filter((n) => !used.has(n));
      if (!free.length) throw new HTTPError({ status: 409, body: { code: "name-full" } });
      number = free[Math.floor(Math.random() * free.length)]!;
    }
    if (current)
      await tx.update(t.players).set({ name, fold: folded, number }).where(eq(t.players.key, key));
    else {
      if ((await tx.select(NAME).from(t.players).where(eq(t.players.id, id))).length)
        throw new HTTPError({ status: 409, body: { code: "id-taken" } });
      await tx
        .insert(t.players)
        .values({ key, id, name, fold: folded, number, created: Date.now() });
    }
    return { id, name, number, avatar };
  });
}

/**
 * What the player shows on their Phigros profile: their self-introduction ("" when they kept the game's placeholder or
 * don't share it), avatar and background (the game's keys, "" for its defaults), and whether they're left out of the
 * leaderboards (their page still opens from its link).
 */
export async function setLook(
  key: Uint8Array,
  look: { intro: string; avatar: string; background: string; unlisted: boolean },
) {
  const short = (value: string) => clean(value).slice(0, 128);
  await db
    .update(t.players)
    .set({
      intro: cleanIntro(look.intro),
      avatar: short(look.avatar),
      background: short(look.background),
      unlisted: look.unlisted,
    })
    .where(eq(t.players.key, key));
}

/**
 * The player's RKS counting all their bests, and counting verified replays only. Each keeps when it last changed, so
 * the earlier player to reach it ranks first.
 */
export async function setRks(tx: Tx, key: Uint8Array, rks: number, verified: number) {
  const now = Date.now();
  const { players } = t;
  await tx
    .update(players)
    .set({
      rks_at: sql`case when ${players.rks} <> ${rks} then ${now} else ${players.rks_at} end`,
      rks,
      rks_verified_at: sql`case when ${players.rks_verified} <> ${verified} then ${now} else ${players.rks_verified_at} end`,
      rks_verified: verified,
    })
    .where(eq(players.key, key));
}
