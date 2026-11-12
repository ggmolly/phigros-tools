import { randomInt } from "node:crypto";
import { HTTPError } from "nitro/h3";
import type { Device } from "../src/phigrospp";
import { lastTime } from "./auth";
import { sqlite } from "./db";
import { player } from "./players";

// a signed-in device shows a code, another device types it and joins the profile with its own key: only public keys
// ever reach the server. a code works once, for 10 minutes
sqlite.run(
  "CREATE TABLE IF NOT EXISTS invites (code TEXT PRIMARY KEY, owner BLOB NOT NULL, expires INTEGER NOT NULL)",
);

// the names players give their devices, over the model a device was added with
sqlite.run("CREATE TABLE IF NOT EXISTS labels (key BLOB PRIMARY KEY, name TEXT NOT NULL)");

const LIFETIME = 10 * 60_000;
// no 0, 1, I or O, which read alike
const ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const NAME_LENGTH = 64;

const expire = sqlite.prepare<unknown, [number]>("DELETE FROM invites WHERE expires < ?");
const dropInvites = sqlite.prepare<unknown, [Uint8Array]>("DELETE FROM invites WHERE owner = ?");
const addInvite = sqlite.prepare<unknown, [string, Uint8Array, number]>(
  "INSERT INTO invites (code, owner, expires) VALUES (?, ?, ?)",
);
const takeInvite = sqlite.prepare<{ owner: Uint8Array }, [string, number]>(
  "DELETE FROM invites WHERE code = ? AND expires >= ? RETURNING owner",
);
const deviceRow = sqlite.prepare<{ key: Uint8Array }, [Uint8Array]>(
  "SELECT key FROM devices WHERE key = ?",
);
const addDevice = sqlite.prepare<unknown, [Uint8Array, Uint8Array, string, number]>(
  "INSERT INTO devices (key, owner, name, added) VALUES (?, ?, ?, ?)",
);
const devicesOf = sqlite.prepare<{ key: Uint8Array; name: string; added: number }, [Uint8Array]>(
  "SELECT key, name, added FROM devices WHERE owner = ? AND removed IS NULL ORDER BY added",
);
const labelOf = sqlite.prepare<{ name: string }, [Uint8Array]>(
  "SELECT name FROM labels WHERE key = ?",
);
const setLabel = sqlite.prepare<unknown, [Uint8Array, string]>(
  "INSERT INTO labels (key, name) VALUES (?1, ?2) ON CONFLICT (key) DO UPDATE SET name = ?2",
);
const dropLabel = sqlite.prepare<unknown, [Uint8Array]>("DELETE FROM labels WHERE key = ?");
const ownedDevice = sqlite.prepare<{ key: Uint8Array }, [Uint8Array, Uint8Array]>(
  "SELECT key FROM devices WHERE key = ? AND owner = ? AND removed IS NULL",
);
const remove = sqlite.prepare<unknown, [number, Uint8Array, Uint8Array]>(
  "UPDATE devices SET removed = ? WHERE key = ? AND owner = ? AND removed IS NULL",
);

/** A new code for the profile, replacing the one it had. */
export function createInvite(owner: Uint8Array): { code: string; expires: number } {
  const code = Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
  const expires = Date.now() + LIFETIME;
  sqlite.transaction(() => {
    expire.run(Date.now());
    dropInvites.run(owner);
    addInvite.run(code, owner, expires);
  })();
  return { code, expires };
}

/**
 * Adds the key that typed a code to the code's profile, under the name of its device. The key mustn't be a profile or
 * a device already: a game leaves its own profile before joining another.
 */
export function redeemInvite(key: Uint8Array, typed: string, name: string) {
  const code = typed.toUpperCase().replace(/[^0-9A-Z]/g, "");
  if (player(key) || deviceRow.get(key))
    throw new HTTPError({ status: 409, body: { code: "registered" } });
  const owner = takeInvite.get(code, Date.now())?.owner;
  if (!owner) throw new HTTPError({ status: 404, body: { code: "no-code" } });
  const cleaned = name.replace(/\p{C}/gu, "").trim().slice(0, NAME_LENGTH) || "?";
  addDevice.run(key, owner, cleaned, Date.now());
  return player(owner)!;
}

/** The devices added to a profile with a code, with when each last signed a request and whether it's the one asking. */
export function listDevices(owner: Uint8Array, asking: Uint8Array): Device[] {
  return devicesOf.all(owner).map((device) => ({
    key: Buffer.from(device.key).toString("hex"),
    name: labelOf.get(device.key)?.name ?? device.name,
    added: device.added,
    seen: lastTime.get(device.key)?.last_time ?? 0,
    you: Buffer.from(device.key).equals(asking),
  }));
}

/** Names a device of the profile as the player wants to see it, "" for its default. */
export function renameDevice(owner: Uint8Array, key: string, name: string) {
  const device = Buffer.from(key, "hex");
  if (!ownedDevice.get(device, owner)) throw HTTPError.status(404);
  const cleaned = name.replace(/\p{C}/gu, "").trim().slice(0, NAME_LENGTH);
  // an empty name goes back to the device's own
  if (cleaned) setLabel.run(device, cleaned);
  else dropLabel.run(device);
}

/** Stops a device of the profile: its requests get 403 from now on. */
export function removeDevice(owner: Uint8Array, key: string) {
  if (!remove.run(Date.now(), Buffer.from(key, "hex"), owner).changes) throw HTTPError.status(404);
}
