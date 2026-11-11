import { createPublicKey, verify } from "node:crypto";
import { type H3Event, HTTPError } from "nitro/h3";
import { sqlite } from "./db";

// spki der header of a raw ed25519 public key
const SPKI = Buffer.from("302a300506032b6570032100", "hex");
const DAY = 86_400_000;
// the key also signs replays, so a request's signature is of its own kind
const DOMAIN = "phigros.tools request v1\0";

sqlite.run("CREATE TABLE IF NOT EXISTS keys (key BLOB PRIMARY KEY, last_time INTEGER NOT NULL)");
const lastTime = sqlite.prepare<{ last_time: number }, [Uint8Array]>(
  "SELECT last_time FROM keys WHERE key = ?",
);
const setTime = sqlite.prepare<unknown, [Uint8Array, number]>(
  "INSERT INTO keys (key, last_time) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET last_time = ?2",
);

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
 * A request signed by Phigros++ (the game's Unity can't set headers): the player's ed25519 public key (32 bytes), a
 * signature (64) of `DOMAIN<METHOD> <path>\n<time><body>`, the time in ms (i64 LE), then the body. The time only goes
 * forward per key, so a request can't be sent again. A time not after the last one gets 409 with the last one, for a
 * device whose clock ran ahead once to catch up.
 */
export async function signed(event: H3Event): Promise<{ key: Uint8Array; body: Uint8Array }> {
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
  const last = lastTime.get(key)?.last_time ?? 0;
  if (time <= last) throw new HTTPError({ status: 409, message: "Old time", body: { last } });
  setTime.run(key, time);
  return { key, body: message.subarray(8) };
}
