import { unzipSync } from "fflate";
import * as v from "valibot";
import { ParseError } from "./binary";
import type { SaveDocumentV1 } from "./document";
import {
  decodeSummary,
  type GameKey,
  type GameProgress,
  MODULE_NAMES,
  type ModuleName,
  PARSEABLE_VERSIONS,
  parseGameKey,
  parseGameProgress,
  parseGameRecord,
  parseProfile,
  parseSettings,
} from "./modules";

/** The game's LeanCloud apps: the global release and the China (TapTap CN) release keep separate accounts and saves. */
export type Region = "global" | "china";
export const CLOUD: Record<Region, { api: string; id: string; key: string }> = {
  global: {
    api: "https://kviehlel.cloud.ap-sg.tapapis.com/1.1",
    id: "kviehleldgxsagpozb",
    key: "tG9CTm0LDD736k9HMM9lBZrbeBGRmUkjSfNLDNib",
  },
  china: {
    api: "https://rak3ffdi.cloud.tds1.tapapis.cn/1.1",
    id: "rAK3FfdieFob2Nn8Am",
    key: "Qr9AEqtuoSVS3zeD6iVbM4ZC0AtkJcQ89tywVyi0",
  },
};
const lcHeaders = (region: Region, token: string) => ({
  "X-LC-Id": CLOUD[region].id,
  "X-LC-Key": CLOUD[region].key,
  "X-LC-Session": token,
});
const SAVE_KEY = "6Jaa0qVAJZuXkZCLiOa/Ax5tIZVu+taKUN1V1nqwkks=";
const SAVE_IV = "Kk/wisgNYwcAV8WVGMgyUw==";
const MB = 1_000_000;
const MAX_ZIP_SIZE = 10 * MB;
const MAX_ENTRY_SIZE = 10 * MB;
const MAX_TOTAL_SIZE = 30 * MB;

export interface GameFile {
  objectId: string;
  name: string;
  url: string;
  bucket?: string;
  metaData?: { size?: number };
}

export interface CloudSave {
  objectId: string;
  name: string;
  summary: string;
  updatedAt: string;
  modifiedAt?: { iso: string };
  playedTime?: number;
  progressValue?: number;
  gameFile: GameFile;
  user?: { objectId?: string };
}

/** The player's newest cloud save. Saves whose owner pointer names someone else are skipped: LeanCloud's _GameSave
 * class isn't guaranteed to be scoped to the session, so trusting the first result could load another account. */
export function latestSave(saves: CloudSave[], playerId: string): CloudSave | undefined {
  const time = (save: CloudSave) => Date.parse(save.modifiedAt?.iso ?? save.updatedAt) || 0;
  return saves
    .filter((save) => !save.user?.objectId || save.user.objectId === playerId)
    .sort((a, b) => time(b) - time(a))[0];
}

export interface SaveArchiveEntry {
  name: ModuleName;
  version: number;
  encryptedBytes: Uint8Array;
  plainBytes: Uint8Array;
}

export interface SaveArchive {
  rawZip: Uint8Array;
  fingerprint: string;
  entries: Record<ModuleName, SaveArchiveEntry>;
}

let keyPromise: Promise<CryptoKey> | undefined;
function cryptoKey() {
  keyPromise ??= crypto.subtle.importKey("raw", Uint8Array.fromBase64(SAVE_KEY), "AES-CBC", false, [
    "decrypt",
  ]);
  return keyPromise;
}

async function decrypt(name: string, encrypted: Uint8Array): Promise<Uint8Array> {
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: Uint8Array.fromBase64(SAVE_IV) },
      await cryptoKey(),
      new Uint8Array(encrypted),
    );
    return new Uint8Array(plain);
  } catch {
    throw new Error(`${name}: decryption failed`);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toHex();
}

function unzip(bytes: Uint8Array): Record<ModuleName, Uint8Array> {
  if (bytes.byteLength > MAX_ZIP_SIZE)
    throw new Error(`Save ZIP exceeds the ${MAX_ZIP_SIZE / MB} MB limit`);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new Error("Not a ZIP file");
  }
  const seen = new Set<string>();
  let total = 0;
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes, {
      filter(file) {
        if (
          file.name.includes("/") ||
          file.name.includes("\\") ||
          !MODULE_NAMES.includes(file.name as ModuleName)
        ) {
          throw new Error(`Unexpected ZIP entry ${JSON.stringify(file.name)}`);
        }
        if (seen.has(file.name))
          throw new Error(`Duplicate ZIP entry ${JSON.stringify(file.name)}`);
        seen.add(file.name);
        if (file.originalSize > MAX_ENTRY_SIZE)
          throw new Error(`${file.name}: entry exceeds the ${MAX_ENTRY_SIZE / MB} MB limit`);
        total += file.originalSize;
        if (total > MAX_TOTAL_SIZE)
          throw new Error(`ZIP expands beyond the ${MAX_TOTAL_SIZE / MB} MB limit`);
        return true;
      },
    });
  } catch (error) {
    throw new Error(`Invalid save ZIP: ${error instanceof Error ? error.message : String(error)}`);
  }
  const missing = MODULE_NAMES.filter((name) => !entries[name]);
  if (missing.length) throw new Error(`Save ZIP is missing: ${missing.join(", ")}`);
  return entries as Record<ModuleName, Uint8Array>;
}

export async function openArchive(zip: Uint8Array): Promise<SaveArchive> {
  const rawZip = new Uint8Array(zip);
  const zipped = unzip(rawZip);
  const pairs = await Promise.all(
    MODULE_NAMES.map(async (name) => {
      const entry = zipped[name];
      if (entry.byteLength < 17) throw new Error(`${name}: encrypted entry is too short`);
      const version = entry[0]!;
      const encryptedBytes = new Uint8Array(entry.subarray(1));
      const plainBytes = await decrypt(name, encryptedBytes);
      return [name, { name, version, encryptedBytes, plainBytes }] as const;
    }),
  );
  return {
    rawZip,
    fingerprint: await sha256(rawZip),
    entries: Object.fromEntries(pairs) as Record<ModuleName, SaveArchiveEntry>,
  };
}

/** Stands in for a gameProgress module this build cannot parse, so the rest of the save still loads. */
const EMPTY_PROGRESS: GameProgress = {
  isFirstRun: false,
  legacyChapterFinished: false,
  alreadyShowCollectionTip: false,
  alreadyShowAutoUnlockINTip: false,
  completed: "",
  songUpdateInfo: 0,
  challengeModeRank: 0,
  money: [0, 0, 0, 0, 0],
  unlockFlagOfSpasmodic: 0,
  unlockFlagOfIgallta: 0,
  unlockFlagOfRrharil: 0,
  flagOfSongRecordKey: 0,
};

export function parseArchive(
  archive: SaveArchive,
  options: { kind?: "cloud" | "zip"; name?: string; cloudUpdatedAt?: string; summary?: string },
): SaveDocumentV1 {
  const warnings: string[] = [];
  const version = (name: ModuleName) => archive.entries[name].version;
  const plain = (name: ModuleName) => archive.entries[name].plainBytes;
  const lenient = (name: ModuleName) => version(name) > PARSEABLE_VERSIONS[name];
  const failed = new Set<ModuleName>();
  /** The game only appends fields on a version bump, so a newer-than-known module is parsed leniently
   * (unknown tail ignored). If it still can't be parsed, that module degrades to empty data instead of
   * failing the whole import — the user browses with a warning. */
  function attempt<T>(
    name: ModuleName,
    parse: (bytes: Uint8Array, version: number, lenient: boolean) => T,
    empty: T,
  ): T {
    try {
      return parse(plain(name), version(name), lenient(name));
    } catch (error) {
      if (!(error instanceof ParseError)) throw error;
      warnings.push(
        `${name} could not be parsed (${error.message}); its data is not shown. Try updating phigros.tools.`,
      );
      failed.add(name);
      return empty;
    }
  }
  const document: SaveDocumentV1 = {
    schema: "phigros-web-save",
    schemaVersion: 1,
    source: {
      kind: options.kind ?? "zip",
      importedAt: new Date().toISOString(),
      ...(options.name ? { name: options.name } : {}),
      ...(options.cloudUpdatedAt ? { cloudUpdatedAt: options.cloudUpdatedAt } : {}),
    },
    moduleVersions: Object.fromEntries(MODULE_NAMES.map((name) => [name, version(name)])) as Record<
      ModuleName,
      number
    >,
    ...(options.summary ? { summary: decodeSummary(options.summary) } : {}),
    profile: attempt("user", parseProfile, undefined),
    settings: attempt("settings", parseSettings, undefined),
    gameKey: attempt("gameKey", parseGameKey, { entries: [], lanotaReadKeys: 0 }),
    gameProgress: attempt("gameProgress", parseGameProgress, EMPTY_PROGRESS),
    songs: attempt("gameRecord", parseGameRecord, []),
  };
  for (const name of MODULE_NAMES)
    if (lenient(name) && !failed.has(name))
      warnings.push(
        `${name} v${version(name)} is newer than this build parses (up to v${PARSEABLE_VERSIONS[name]}); its newest fields are unknown, so some info may be missing. Try updating phigros.tools.`,
      );
  return warnings.length ? { ...document, warnings } : document;
}

const player = v.object({
  objectId: v.pipe(v.string(), v.minLength(1)),
  nickname: v.fallback(v.optional(v.string()), undefined),
});

/** Who a session token belongs to. With no region given, tries the global app, then the China one. */
export async function identifyPlayer(
  token: string,
  region?: Region,
  signal?: AbortSignal,
): Promise<{ objectId: string; nickname?: string; region: Region }> {
  let status = 0;
  for (const candidate of region ? [region] : (["global", "china"] as const)) {
    const response = await fetch(`${CLOUD[candidate].api}/users/me`, {
      signal,
      headers: lcHeaders(candidate, token),
    });
    status = response.status;
    if (!response.ok) continue;
    const user = v.safeParse(player, await response.json());
    if (!user.success) throw new Error("TapTap did not return a player ID");
    return { ...user.output, region: candidate };
  }
  throw new Error(`TapTap account verification failed: HTTP ${status}`);
}

export async function listSaves(
  token: string,
  region: Region,
  signal?: AbortSignal,
): Promise<CloudSave[]> {
  const response = await fetch(`${CLOUD[region].api}/gamesaves?limit=100`, {
    signal,
    headers: lcHeaders(region, token),
  });
  if (!response.ok) throw new Error(`TapTap API: HTTP ${response.status} ${await response.text()}`);
  const body = (await response.json()) as { results?: unknown };
  if (!Array.isArray(body.results)) throw new Error("TapTap API returned an invalid save list");
  return body.results as CloudSave[];
}

export async function fetchSaveBytes(save: CloudSave, signal?: AbortSignal): Promise<Uint8Array> {
  const url = new URL(save.gameFile.url);
  if (url.protocol !== "https:") throw new Error("Save download URL is not HTTPS");
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`Save download: HTTP ${response.status}`);
  const length = Number(response.headers.get("content-length"));
  if (length > MAX_ZIP_SIZE) throw new Error(`Save ZIP exceeds the ${MAX_ZIP_SIZE / MB} MB limit`);
  return new Uint8Array(await response.arrayBuffer());
}
