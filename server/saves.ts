import { mkdirSync, readFileSync } from "node:fs";
import { zipSync } from "fflate";
import { HTTPError } from "nitro/h3";
import { MODULE_NAMES } from "../src/modules";
import { sqlite } from "./db";

// a player's whole save, as their game's cloud save would be: a zip of its modules, each still encrypted the game's way
// (see src/save.ts). the site reads it like a save fetched from TapTap
const DIR = "./data/saves";
mkdirSync(DIR, { recursive: true });

sqlite.run(
  "CREATE TABLE IF NOT EXISTS saves (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, size INTEGER NOT NULL)",
);

const MAX = 4 * 1024 * 1024;
const store = sqlite.prepare<unknown, [string, number, number]>(
  `INSERT INTO saves (id, updated, size) VALUES (?1, ?2, ?3)
   ON CONFLICT (id) DO UPDATE SET updated = ?2, size = ?3`,
);
const stored = sqlite.prepare<{ updated: number }, [string]>(
  "SELECT updated FROM saves WHERE id = ?",
);

/** The game's module files one after the other, each a 1 byte name length, the name, a 4 byte LE length and the file. */
export async function storeSave(id: string, body: Uint8Array) {
  if (body.length > MAX) throw HTTPError.status(413, "Save too large");
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const files: Record<string, Uint8Array> = {};
  for (let at = 0; at < body.length; ) {
    const name = new TextDecoder().decode(body.subarray(at + 1, at + 1 + body[at]!));
    at += 1 + body[at]!;
    const size = view.getUint32(at, true);
    files[name] = body.subarray(at + 4, at + 4 + size);
    at += 4 + size;
  }
  const names = Object.keys(files).sort();
  if (names.join() !== [...MODULE_NAMES].sort().join()) throw HTTPError.status(400, "Not a save");
  const zip = zipSync(files);
  await Bun.write(`${DIR}/${id}.zip`, zip);
  store.run(id, Date.now(), zip.length);
}

/** The player's uploaded save as a zip, and when it was uploaded, or undefined when there's none. */
export function savedSave(id: string): { zip: Uint8Array; updated: number } | undefined {
  const row = stored.get(id);
  return row && { zip: readFileSync(`${DIR}/${id}.zip`), updated: row.updated };
}
