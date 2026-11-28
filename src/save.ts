import { unzipSync } from "fflate";
import { ParseError } from "./binary";
import { catalogManifest } from "./catalog";
import { blankDocument, type SaveDocumentV1 } from "./document";
import { AppError } from "./i18n/errors";
import { calculateRanking } from "./metrics";
import {
  countLevels,
  decodeSummary,
  encodeSummary,
  type GameProgress,
  MODULE_NAMES,
  type ModuleName,
  PARSEABLE_VERSIONS,
  parseGameKey,
  parseGameProgress,
  parseGameRecord,
  parseProfile,
  parseSettings,
  writeGameKey,
  writeGameProgress,
  writeGameRecord,
  writeProfile,
  writeSettings,
} from "./modules";

const SAVE_KEY = "6Jaa0qVAJZuXkZCLiOa/Ax5tIZVu+taKUN1V1nqwkks=";
const SAVE_IV = "Kk/wisgNYwcAV8WVGMgyUw==";
/** The save version of this key and layout, which a summary names for the game to pick them (CloudSaveSummary). */
const SAVE_VERSION = 7;
const MB = 1_000_000;
const MAX_ZIP_SIZE = 10 * MB;
const MAX_ENTRY_SIZE = 10 * MB;
const MAX_TOTAL_SIZE = 30 * MB;

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
    "encrypt",
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
    throw new AppError("decryptFailed", name);
  }
}

async function sha256(bytes: Uint8Array): Promise<string> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(bytes))).toHex();
}

function unzip(bytes: Uint8Array): Record<ModuleName, Uint8Array> {
  if (bytes.byteLength > MAX_ZIP_SIZE) throw new AppError("zipTooLarge", String(MAX_ZIP_SIZE / MB));
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b || bytes[2] !== 0x03 || bytes[3] !== 0x04) {
    throw new AppError("notZip");
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
          throw new AppError("unexpectedEntry", JSON.stringify(file.name));
        }
        if (seen.has(file.name)) throw new AppError("duplicateEntry", JSON.stringify(file.name));
        seen.add(file.name);
        if (file.originalSize > MAX_ENTRY_SIZE)
          throw new AppError("entryTooLarge", file.name, String(MAX_ENTRY_SIZE / MB));
        total += file.originalSize;
        if (total > MAX_TOTAL_SIZE) throw new AppError("zipExpands", String(MAX_TOTAL_SIZE / MB));
        return true;
      },
    });
  } catch (error) {
    throw new AppError("invalidZip", error instanceof Error ? error : String(error));
  }
  const missing = MODULE_NAMES.filter((name) => !entries[name]);
  if (missing.length) throw new AppError("missingEntries", missing.join(", "));
  return entries as Record<ModuleName, Uint8Array>;
}

export async function openArchive(zip: Uint8Array): Promise<SaveArchive> {
  const rawZip = new Uint8Array(zip);
  const zipped = unzip(rawZip);
  const pairs = await Promise.all(
    MODULE_NAMES.map(async (name) => {
      const entry = zipped[name];
      if (entry.byteLength < 17) throw new AppError("entryTooShort", name);
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

/**
 * A document as the files its game would upload (see pack in src/phigrospp.ts): its modules, each a version byte then
 * AES-CBC like the game writes them, and the summary the game reads before loading them.
 */
export async function buildSave(document: SaveDocumentV1): Promise<Record<string, Uint8Array>> {
  const blank = blankDocument();
  const profile = document.profile ?? blank.profile!;
  const plain: Record<ModuleName, Uint8Array> = {
    gameKey: writeGameKey(document.gameKey),
    gameProgress: writeGameProgress(document.gameProgress),
    gameRecord: writeGameRecord(document.songs),
    settings: writeSettings(document.settings ?? blank.settings!),
    user: writeProfile(profile),
  };
  const summary = encodeSummary({
    saveVersion: SAVE_VERSION,
    gameVersion: catalogManifest.gameVersion,
    challengeModeRank: document.gameProgress.challengeModeRank,
    rankingScore: calculateRanking({ songs: document.songs }).rankingScore,
    avatar: profile.avatar,
    counts: countLevels(document.songs),
  });
  const files: Record<string, Uint8Array> = { summary: new TextEncoder().encode(summary) };
  for (const name of MODULE_NAMES) {
    const encrypted = await crypto.subtle.encrypt(
      { name: "AES-CBC", iv: Uint8Array.fromBase64(SAVE_IV) },
      await cryptoKey(),
      new Uint8Array(plain[name]),
    );
    files[name] = new Uint8Array([PARSEABLE_VERSIONS[name], ...new Uint8Array(encrypted)]);
  }
  return files;
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
  options: {
    kind?: "zip" | "phigrospp";
    name?: string;
    cloudUpdatedAt?: string;
    summary?: string;
  },
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
