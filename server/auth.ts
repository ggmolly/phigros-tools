import { createPublicKey, verify } from "node:crypto";
import { eq, lt } from "drizzle-orm";
import { assertBodySize, type H3Event, HTTPError } from "nitro/h3";
import * as v from "valibot";
import type { PlayerName } from "../src/plays";
import { db } from "./db";
import { markSeen, player, playerId } from "./players";
import * as t from "./schema";

// spki der header of a raw ed25519 public key
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const DAY = 86_400_000;
const MAX_BODY = 8 * 1024 * 1024;
// the key also signs replays, so a request's signature is of its own kind
const DOMAIN = "phigros.tools request v1\0";

/** The profile a device signs for and when it was removed from it, undefined for a key that's no device. */
export async function deviceOf(key: Uint8Array) {
  const [device] = await db
    .select({ owner: t.devices.owner, removed: t.devices.removed })
    .from(t.devices)
    .where(eq(t.devices.key, key));
  return device;
}

/** Whether `signature` is the ed25519 signature of `message` by the raw public `key`. */
export function verifySignature(
  key: Uint8Array,
  message: Uint8Array,
  signature: Uint8Array,
): boolean {
  const publicKey = createPublicKey({
    key: Buffer.concat([SPKI, key]),
    format: "der",
    type: "spki",
  });
  return verify(null, message, publicKey, signature);
}

/**
 * Who holds a socket: the game signs the nonce the server greeted it with, after `domain` so the signature is good for
 * nothing else, with its profile's key or a device's. The code of the refusal when it isn't a profile's.
 */
export async function socketPlayer(
  domain: string,
  nonce: string,
  m: { key: string; sig: string },
): Promise<{ player: PlayerName; key: Uint8Array } | "auth" | "no-profile"> {
  const key = Buffer.from(m.key, "hex");
  if (!verifySignature(key, Buffer.from(domain + nonce), Buffer.from(m.sig, "hex"))) return "auth";
  const device = await deviceOf(key);
  const owner = device?.owner ?? key;
  const found = !device?.removed && (await player(owner));
  if (!found) return "no-profile";
  await markSeen(owner);
  return { player: found, key: owner };
}

/**
 * A request signed by Phigros++ (the game's Unity can't set headers): the player's ed25519 public key (32 bytes), a
 * signature (64) of `DOMAIN<METHOD> <path>\n<time><body>`, the time in ms (i64 LE), then the body. The time only goes
 * forward per key, so a request can't be sent again. A time not after the last one gets 409 with the last one, for a
 * device whose clock ran ahead once to catch up. A request over 8 MB gets 413 without being read to its end.
 * `key` is the profile's key, `device` the one that signed: they differ for a device added with a code, and a removed
 * device gets 403 `removed`.
 */
export async function signed(
  event: H3Event,
): Promise<{ key: Uint8Array; device: Uint8Array; body: Uint8Array }> {
  assertBodySize(event, MAX_BODY);
  const bytes = new Uint8Array(await event.req.arrayBuffer());
  if (bytes.length < 104) throw HTTPError.status(400);
  const key = bytes.subarray(0, 32);
  const signature = bytes.subarray(32, 96);
  const message = bytes.subarray(96);
  const time = Number(Buffer.from(message.buffer, message.byteOffset, 8).readBigInt64LE());
  const signedBytes = Buffer.concat([
    Buffer.from(`${DOMAIN}${event.req.method} ${event.url.pathname}\n`),
    message,
  ]);
  if (!verifySignature(key, signedBytes, signature)) throw HTTPError.status(401, "Bad signature");
  if (Math.abs(time - Date.now()) > DAY) throw HTTPError.status(401, "Bad time");
  // one statement moves the time forward or doesn't: of a request sent twice at once, one finds it moved
  const [moved] = await db
    .insert(t.keys)
    .values({ key, last_time: time })
    .onConflictDoUpdate({
      target: t.keys.key,
      set: { last_time: time },
      setWhere: lt(t.keys.last_time, time),
    })
    .returning({ key: t.keys.key });
  if (!moved) {
    const [{ last }] = await db
      .select({ last: t.keys.last_time })
      .from(t.keys)
      .where(eq(t.keys.key, key));
    throw new HTTPError({ status: 409, message: "Old time", body: { last } });
  }
  const device = await deviceOf(key);
  if (device?.removed) throw new HTTPError({ status: 403, body: { code: "removed" } });
  const owner = device?.owner ?? key;
  await markSeen(owner);
  // the request's log line names who signed it (server/plugins/log.ts)
  event.context.player = playerId(owner);
  return { key: owner, device: key, body: message.subarray(8) };
}

/** A signed request's JSON body as the schema reads it, a 400 when it doesn't fit. */
export function signedJson<Schema extends v.GenericSchema>(schema: Schema, body: Uint8Array) {
  try {
    return v.parse(schema, JSON.parse(new TextDecoder().decode(body)));
  } catch (error) {
    throw HTTPError.status(400, (error as Error).message);
  }
}
