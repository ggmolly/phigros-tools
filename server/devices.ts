import { randomInt } from "node:crypto";
import { and, eq, gte, isNull, lt } from "drizzle-orm";
import { HTTPError } from "nitro/h3";
import type { Device } from "../src/phigrospp";
import { db, lock } from "./db";
import { player } from "./players";
import * as t from "./schema";

// a signed-in device shows a code, another device types it and joins the profile with its own key: only public keys
// ever reach the server. a code works once, for 10 minutes
const LIFETIME = 10 * 60_000;
// no 0, 1, I or O, which read alike
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const NAME_LENGTH = 64;

const { devices, invites, labels } = t;
const owned = (owner: Uint8Array, key: Uint8Array) =>
  and(eq(devices.key, key), eq(devices.owner, owner), isNull(devices.removed));

/** A new code for the profile, replacing the one it had. */
export async function createInvite(owner: Uint8Array): Promise<{ code: string; expires: number }> {
  const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expires = Date.now() + LIFETIME;
  await db.delete(invites).where(lt(invites.expires, Date.now()));
  await db
    .insert(invites)
    .values({ code, owner, expires })
    .onConflictDoUpdate({ target: invites.owner, set: { code, expires } });
  return { code, expires };
}

/**
 * Adds the key that typed a code to the code's profile, under the name of its device. The key mustn't be a profile or
 * a device already: a game leaves its own profile before joining another.
 */
export async function redeemInvite(key: Uint8Array, typed: string, name: string) {
  const code = typed.toUpperCase().replace(/[^0-9A-Z]/g, "");
  const cleaned = name.replace(/\p{C}/gu, "").trim().slice(0, NAME_LENGTH) || "?";
  const owner = await db.transaction(async (tx) => {
    // the same key registering or joining at once waits here (see setName): it becomes one or the other
    await lock(tx, key);
    const [profile] = await tx.select().from(t.players).where(eq(t.players.key, key));
    const [device] = await tx.select().from(devices).where(eq(devices.key, key));
    if (profile || device) throw new HTTPError({ status: 409, body: { code: "registered" } });
    const [invite] = await tx
      .delete(invites)
      .where(and(eq(invites.code, code), gte(invites.expires, Date.now())))
      .returning({ owner: invites.owner });
    if (!invite) throw new HTTPError({ status: 404, body: { code: "no-code" } });
    await tx.insert(devices).values({ key, owner: invite.owner, name: cleaned, added: Date.now() });
    return invite.owner;
  });
  return (await player(owner))!;
}

/** The devices added to a profile with a code, with when each last signed a request and whether it's the one asking. */
export async function listDevices(owner: Uint8Array, asking: Uint8Array): Promise<Device[]> {
  const rows = await db
    .select({
      key: devices.key,
      name: devices.name,
      label: labels.name,
      added: devices.added,
      seen: t.keys.last_time,
    })
    .from(devices)
    .leftJoin(labels, eq(labels.key, devices.key))
    .leftJoin(t.keys, eq(t.keys.key, devices.key))
    .where(and(eq(devices.owner, owner), isNull(devices.removed)))
    .orderBy(devices.added);
  return rows.map((device) => ({
    key: Buffer.from(device.key).toString("hex"),
    name: device.label ?? device.name,
    added: device.added,
    seen: device.seen ?? 0,
    you: Buffer.from(device.key).equals(asking),
  }));
}

/** Names a device of the profile as the player wants to see it, "" for its default. */
export async function renameDevice(owner: Uint8Array, key: string, name: string) {
  const device = Buffer.from(key, "hex");
  if (!(await db.select().from(devices).where(owned(owner, device))).length)
    throw HTTPError.status(404);
  const cleaned = name.replace(/\p{C}/gu, "").trim().slice(0, NAME_LENGTH);
  // an empty name goes back to the device's own
  if (cleaned)
    await db
      .insert(labels)
      .values({ key: device, name: cleaned })
      .onConflictDoUpdate({ target: labels.key, set: { name: cleaned } });
  else await db.delete(labels).where(eq(labels.key, device));
}

/** Stops a device of the profile: its requests get 403 from now on. */
export async function removeDevice(owner: Uint8Array, key: string) {
  const removed = await db
    .update(devices)
    .set({ removed: Date.now() })
    .where(owned(owner, Buffer.from(key, "hex")))
    .returning({ key: devices.key });
  if (!removed.length) throw HTTPError.status(404);
}
