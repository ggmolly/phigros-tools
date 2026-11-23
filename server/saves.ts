import { mkdirSync, readFileSync, rmSync } from "node:fs";
import { eq } from "drizzle-orm";
import { unzipSync, zipSync } from "fflate";
import { HTTPError } from "nitro/h3";
import { MODULE_NAMES } from "../src/modules";
import { db } from "./db";
import { offers, saves } from "./schema";

// a player's whole save, as their game's cloud save would be: a zip of its modules, each still encrypted the game's way
// (see src/save.ts), and the game's summary of it (CloudSaveSummary, base64), which says its save version. next to it,
// the offer: a save the player sent from the site, that their game offers to load once
const DIR = "./data/saves";
mkdirSync(DIR, { recursive: true });

export type Slot = "saves" | "offers";
const FILE = { saves: "", offers: ".offer" };
const MAX = 4 * 1024 * 1024;
const TABLES = { saves, offers };
const path = (slot: Slot, id: string) => `${DIR}/${id}${FILE[slot]}.zip`;

async function stored(slot: Slot, id: string) {
  const [row] = await db.select().from(TABLES[slot]).where(eq(TABLES[slot].id, id));
  return row;
}

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

function pack(files: Record<string, Uint8Array>) {
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
  const row = {
    updated: Date.now(),
    size: zip.length,
    summary: summary ? new TextDecoder().decode(summary) : null,
  };
  await db
    .insert(TABLES[slot])
    .values({ id, ...row })
    .onConflictDoUpdate({ target: TABLES[slot].id, set: row });
  return row.updated;
}

/**
 * The player's uploaded save for their game to load (CloudSaveManager.LoadFromFolder), packed like it was sent: when
 * it was uploaded (ms), its summary when it came with one, and its module files. Undefined when there's none.
 */
export async function savedSaveFiles(id: string, slot: Slot = "saves") {
  const row = await stored(slot, id);
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
export const savedSummary = async (id: string) => (await stored("saves", id))?.summary ?? undefined;

/** When the save of the slot was stored (ms), undefined when there's none. */
export const savedAt = async (id: string, slot: Slot) => (await stored(slot, id))?.updated;

/** Forgets the offer once the game loaded or declined it. */
export async function dropOffer(id: string) {
  await db.delete(offers).where(eq(offers.id, id));
  rmSync(path("offers", id), { force: true });
}
