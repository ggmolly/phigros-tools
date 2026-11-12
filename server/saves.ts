import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { unzipSync, zipSync } from "fflate";
import { HTTPError } from "nitro/h3";
import { MODULE_NAMES } from "../src/modules";
import { sqlite } from "./db";

// a player's whole save, as their game's cloud save would be: a zip of its modules, each still encrypted the game's way
// (see src/save.ts), and the game's summary of it (CloudSaveSummary, base64), which says its save version. next to it,
// the offer: a save the player sent from the site, that their game offers to load once
const DIR = "./data/saves";
mkdirSync(DIR, { recursive: true });

sqlite.run(
  "CREATE TABLE IF NOT EXISTS saves (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, size INTEGER NOT NULL)",
);
if (!sqlite.query("SELECT 1 FROM pragma_table_info('saves') WHERE name = 'summary'").get())
  sqlite.run("ALTER TABLE saves ADD COLUMN summary TEXT");

sqlite.run(
  "CREATE TABLE IF NOT EXISTS offers (id TEXT PRIMARY KEY, updated INTEGER NOT NULL, size INTEGER NOT NULL, summary TEXT)",
);

export type Slot = "saves" | "offers";
const FILE = { saves: "", offers: ".offer" };
const MAX = 4 * 1024 * 1024;
const statements = (slot: Slot) => ({
  store: sqlite.prepare<unknown, [string, number, number, string | null]>(
    `INSERT INTO ${slot} (id, updated, size, summary) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (id) DO UPDATE SET updated = ?2, size = ?3, summary = ?4`,
  ),
  stored: sqlite.prepare<{ updated: number; summary: string | null }, [string]>(
    `SELECT updated, summary FROM ${slot} WHERE id = ?`,
  ),
  drop: sqlite.prepare<unknown, [string]>(`DELETE FROM ${slot} WHERE id = ?`),
});
const SLOTS = { saves: statements("saves"), offers: statements("offers") };
const path = (slot: Slot, id: string) => `${DIR}/${id}${FILE[slot]}.zip`;

/** Files one after the other, each a 1 byte name length, the name, a 4 byte LE length and the file. */
function unpack(body: Uint8Array): Record<string, Uint8Array> {
  const view = new DataView(body.buffer, body.byteOffset, body.byteLength);
  const files: Record<string, Uint8Array> = {};
  for (let at = 0; at < body.length; ) {
    const name = new TextDecoder().decode(body.subarray(at + 1, at + 1 + body[at]!));
    at += 1 + body[at]!;
    const size = view.getUint32(at, true);
    files[name] = body.subarray(at + 4, at + 4 + size);
    at += 4 + size;
  }
  return files;
}

function pack(files: Record<string, Uint8Array>): Uint8Array {
  const parts = Object.entries(files).flatMap(([name, data]) => {
    const head = new Uint8Array(1 + name.length + 4);
    head[0] = name.length;
    head.set(new TextEncoder().encode(name), 1);
    new DataView(head.buffer).setUint32(1 + name.length, data.length, true);
    return [head, data];
  });
  return Buffer.concat(parts);
}

/** The game's module files and its summary as Phigros++ sends them (see pack). Returns when it was stored (ms). */
export async function storeSave(id: string, body: Uint8Array, slot: Slot = "saves") {
  if (body.length > MAX) throw HTTPError.status(413, "Save too large");
  const { summary, ...files } = unpack(body);
  if (Object.keys(files).sort().join() !== [...MODULE_NAMES].sort().join())
    throw HTTPError.status(400, "Not a save");
  const zip = zipSync(files);
  await Bun.write(path(slot, id), zip);
  const updated = Date.now();
  SLOTS[slot].store.run(
    id,
    updated,
    zip.length,
    summary ? new TextDecoder().decode(summary) : null,
  );
  return updated;
}

/**
 * The player's uploaded save for their game to load (CloudSaveManager.LoadFromFolder), packed like it was sent: when
 * it was uploaded (ms), its summary when it came with one, and its module files. Undefined when there's none.
 */
export function savedSaveFiles(id: string, slot: Slot = "saves"): Uint8Array | undefined {
  const row = SLOTS[slot].stored.get(id);
  if (!row) return undefined;
  const encoder = new TextEncoder();
  return pack({
    updated: encoder.encode(String(row.updated)),
    ...(row.summary ? { summary: encoder.encode(row.summary) } : {}),
    ...unzipSync(readFileSync(path(slot, id))),
  });
}

/** Where a player's uploaded save is kept, and its summary when it came with one. */
export const saveFile = (id: string) => path("saves", id);
export const savedSummary = (id: string) => SLOTS.saves.stored.get(id)?.summary ?? undefined;

/** When the save of the slot was stored (ms), undefined when there's none. */
export const savedAt = (id: string, slot: Slot) => SLOTS[slot].stored.get(id)?.updated;

/** Forgets the offer once the game loaded or declined it. */
export function dropOffer(id: string) {
  SLOTS.offers.drop.run(id);
  rmSync(path("offers", id), { force: true });
}
