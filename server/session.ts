import { createHmac, timingSafeEqual } from "node:crypto";
import { readFileSync } from "node:fs";
import type { SaveDocumentV1 } from "../src/document";
import { openArchive, parseArchive } from "../src/save";
import { deviceOf } from "./auth";
import { config } from "./config";
import { keyOf } from "./players";
import { profilePage } from "./profiles";
import { savedAt, savedSummary, saveFile } from "./saves";

// the cookie of a browser signed in to a Phigros++ profile, so pages render with the player's save on the server: their
// id and the device key that signed in, signed by the server. it's refused once that device is removed
export const SESSION = "ppp";
const DOMAIN = "phigros.tools session v1\0";

const mac = (value: string) =>
  createHmac("sha256", config.hash_secret)
    .update(DOMAIN + value)
    .digest("base64url");

/** The cookie's value for a player's id and the key of the device that signed in. */
export const sessionValue = (id: string, device: Uint8Array) => {
  const value = `${id}.${Buffer.from(device).toString("hex")}`;
  return `${value}.${mac(value)}`;
};

/** What a cookie signed here says: a player's id and the device that signed in, which may have been removed since. */
export function sessionClaim(cookie: string | undefined) {
  const [id, device, signature] = cookie?.split(".") ?? [];
  if (!id || !device || !signature) return undefined;
  const expected = Buffer.from(mac(`${id}.${device}`));
  if (expected.length !== signature.length || !timingSafeEqual(expected, Buffer.from(signature)))
    return undefined;
  return { id, device: Buffer.from(device, "hex") };
}

/** The player of a valid cookie: signed here, by a device still signed in to that player. */
export async function sessionPlayer(cookie: string | undefined) {
  const claim = sessionClaim(cookie);
  const key = claim && (await keyOf(claim.id));
  if (!key) return undefined;
  // the profile's own key, or a device added to it and not removed
  const added = await deviceOf(claim.device);
  const owner = claim.device.equals(key) ? key : added && !added.removed && added.owner;
  return owner && Buffer.from(owner).equals(key) ? { id: claim.id, key } : undefined;
}

// the uploaded save read once per upload, it's read for every page the player opens
let parsed: { id: string; at: number; document: SaveDocumentV1 } | undefined;

/** What a signed-in player's pages show: their save as the site reads it and their public profile. */
export async function home(id: string) {
  const profile = await profilePage(id);
  if (!profile) return undefined;
  const at = await savedAt(id, "saves");
  if (at === undefined) return { id, profile, document: undefined };
  if (parsed?.id !== id || parsed.at !== at) {
    const archive = await openArchive(readFileSync(saveFile(id)));
    const summary = await savedSummary(id);
    const document = parseArchive(archive, {
      kind: "phigrospp",
      cloudUpdatedAt: new Date(at).toISOString(),
      ...(summary ? { summary } : {}),
    });
    parsed = { id, at, document };
  }
  return { id, profile, document: parsed.document };
}
