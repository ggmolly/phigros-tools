import { ParseError, Reader } from "./binary";

export const LEVELS = ["EZ", "HD", "IN", "AT"] as const;
export type LevelName = (typeof LEVELS)[number];
export type ModuleName = "gameKey" | "gameProgress" | "gameRecord" | "settings" | "user";
export const MODULE_NAMES: ModuleName[] = [
  "gameKey",
  "gameProgress",
  "gameRecord",
  "settings",
  "user",
];

export interface LevelRecord {
  score: number;
  accuracy: number;
}

export interface SongRecord {
  rawSongId: string;
  songId: string;
  fc: number;
  levels: [LevelRecord | null, LevelRecord | null, LevelRecord | null, LevelRecord | null];
}

export interface Summary {
  saveVersion: number;
  gameVersion: number;
  challengeModeRank: number;
  rankingScore: number;
  avatar: string;
  counts: { cleared: number; fc: number; phi: number }[];
}

export interface Profile {
  idShown: boolean;
  intro: string;
  avatar: string;
  background: string;
}

export interface Settings {
  chordSupport: boolean;
  fcAPIndicator: boolean;
  enableHitSound: boolean;
  lowResolutionMode: boolean;
  device: string;
  brightness: number;
  musicVolume: number;
  effectVolume: number;
  hitSoundVolume: number;
  offset: number;
  noteScale: number;
}

interface GameKeyEntry {
  key: string;
  valueFlags: number;
  values: (number | null)[];
}

export interface GameKey {
  entries: GameKeyEntry[];
  lanotaReadKeys: number;
  camelliaReadKey?: boolean;
  sideStory4BeginReadKey?: number;
  oldScoreClearedV390?: number;
}

export interface GameProgress {
  isFirstRun: boolean;
  legacyChapterFinished: boolean;
  alreadyShowCollectionTip: boolean;
  alreadyShowAutoUnlockINTip: boolean;
  completed: string;
  songUpdateInfo: number;
  challengeModeRank: number;
  money: number[];
  unlockFlagOfSpasmodic: number;
  unlockFlagOfIgallta: number;
  unlockFlagOfRrharil: number;
  flagOfSongRecordKey: number;
  randomVersionUnlocked?: number;
  chapter8UnlockBegin?: boolean;
  chapter8UnlockSecondPhase?: boolean;
  chapter8Passed?: boolean;
  chapter8SongUnlocked?: number;
  flagOfSongRecordKeyTakumi?: number;
}

function supported(module: ModuleName, version: number, min: number, max = min) {
  if (version < min || version > max) {
    throw new ParseError(
      `unsupported version ${version} (supported ${min}${max === min ? "" : `-${max}`})`,
      module,
      0,
    );
  }
}

export function decodeSummary(encoded: string): Summary {
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.fromBase64(encoded);
  } catch {
    throw new Error("summary: invalid base64");
  }
  const r = new Reader(bytes, "summary");
  const summary: Summary = {
    saveVersion: r.u8("saveVersion"),
    challengeModeRank: r.i16("challengeModeRank"),
    rankingScore: r.f32("rankingScore"),
    gameVersion: r.varshort("gameVersion"),
    avatar: r.string("avatar").replaceAll("\0", ""),
    counts: [],
  };
  summary.counts = LEVELS.map((level) => ({
    cleared: r.i16(`${level}.cleared`),
    fc: r.i16(`${level}.fc`),
    phi: r.i16(`${level}.phi`),
  }));
  r.finish();
  return summary;
}

export function parseGameRecord(bytes: Uint8Array, version: number): SongRecord[] {
  supported("gameRecord", version, 1);
  const r = new Reader(bytes, "gameRecord");
  const count = r.varshort("count");
  const songs: SongRecord[] = [];
  const ids = new Set<string>();
  for (let index = 0; index < count; index += 1) {
    const rawSongId = r.string(`songs[${index}].id`);
    const bodyLength = r.u8(`songs[${index}].bodyLength`);
    const body = r.subReader(bodyLength, `songs[${index}].body`);
    const existing = body.u8("existing");
    const fc = body.u8("fc");
    if (existing & 0xf0)
      throw new ParseError(
        `invalid level flags 0x${existing.toString(16)}`,
        "gameRecord",
        r.offset,
        `songs[${index}].existing`,
      );
    if (fc & 0xf0)
      throw new ParseError(
        `invalid FC flags 0x${fc.toString(16)}`,
        "gameRecord",
        r.offset,
        `songs[${index}].fc`,
      );
    if (fc & ~existing)
      throw new ParseError(
        "FC flag set for a missing level",
        "gameRecord",
        r.offset,
        `songs[${index}].fc`,
      );
    const levels = LEVELS.map((level, levelIndex) =>
      (existing >> levelIndex) & 1
        ? { score: body.i32(`${level}.score`), accuracy: body.f32(`${level}.accuracy`) }
        : null,
    ) as SongRecord["levels"];
    body.finish();
    const songId = rawSongId.endsWith(".0") ? rawSongId.slice(0, -2) : rawSongId;
    if (ids.has(songId))
      throw new ParseError(`duplicate song ID ${JSON.stringify(songId)}`, "gameRecord", r.offset);
    ids.add(songId);
    songs.push({ rawSongId, songId, fc, levels });
  }
  r.finish();
  return songs;
}

export function parseProfile(bytes: Uint8Array, version: number): Profile {
  supported("user", version, 1);
  const r = new Reader(bytes, "user");
  const profile = {
    idShown: r.bool("showPlayerId"),
    intro: r.string("selfIntro"),
    avatar: r.string("avatar"),
    background: r.string("background"),
  };
  r.finish();
  return profile;
}

export function parseSettings(bytes: Uint8Array, version: number): Settings {
  supported("settings", version, 1);
  const r = new Reader(bytes, "settings");
  const settings = {
    chordSupport: r.bool("chordSupport"),
    fcAPIndicator: r.bool("fcAPIndicator"),
    enableHitSound: r.bool("enableHitSound"),
    lowResolutionMode: r.bool("lowResolutionMode"),
    device: r.string("deviceName"),
    brightness: r.f32("bright"),
    musicVolume: r.f32("musicVolume"),
    effectVolume: r.f32("effectVolume"),
    hitSoundVolume: r.f32("hitSoundVolume"),
    offset: r.f32("soundOffset"),
    noteScale: r.f32("noteScale"),
  };
  r.finish();
  return settings;
}

export function parseGameKey(bytes: Uint8Array, version: number): GameKey {
  supported("gameKey", version, 1, 3);
  const r = new Reader(bytes, "gameKey");
  const count = r.varshort("count");
  const entries: GameKeyEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    const key = r.string(`entries[${index}].key`);
    const body = r.subReader(r.u8(`entries[${index}].bodyLength`), `entries[${index}].body`);
    const valueFlags = body.u8("valueFlags");
    if (valueFlags & 0xe0)
      throw new ParseError(`invalid value flags 0x${valueFlags.toString(16)}`, "gameKey", r.offset);
    const values = Array.from({ length: 5 }, (_, valueIndex) =>
      (valueFlags >> valueIndex) & 1 ? body.u8(`values[${valueIndex}]`) : null,
    );
    body.finish();
    entries.push({ key, valueFlags, values });
  }
  const result: GameKey = { entries, lanotaReadKeys: r.u8("lanotaReadKeys") };
  if (version >= 2) result.camelliaReadKey = r.bool("camelliaReadKey");
  if (version >= 3) {
    result.sideStory4BeginReadKey = r.u8("sideStory4BeginReadKey");
    result.oldScoreClearedV390 = r.u8("oldScoreClearedV390");
  }
  r.finish();
  return result;
}

export function parseGameProgress(bytes: Uint8Array, version: number): GameProgress {
  supported("gameProgress", version, 1, 4);
  const r = new Reader(bytes, "gameProgress");
  const result: GameProgress = {
    isFirstRun: r.bool("isFirstRun"),
    legacyChapterFinished: r.bool("legacyChapterFinished"),
    alreadyShowCollectionTip: r.bool("alreadyShowCollectionTip"),
    alreadyShowAutoUnlockINTip: r.bool("alreadyShowAutoUnlockINTip"),
    completed: r.string("completed"),
    songUpdateInfo: r.u8("songUpdateInfo"),
    challengeModeRank: r.i16("challengeModeRank"),
    money: Array.from({ length: 5 }, (_, index) => r.varshort(`money[${index}]`)),
    unlockFlagOfSpasmodic: r.u8("unlockFlagOfSpasmodic"),
    unlockFlagOfIgallta: r.u8("unlockFlagOfIgallta"),
    unlockFlagOfRrharil: r.u8("unlockFlagOfRrharil"),
    flagOfSongRecordKey: r.u8("flagOfSongRecordKey"),
  };
  if (version >= 2) result.randomVersionUnlocked = r.u8("randomVersionUnlocked");
  if (version >= 3) {
    result.chapter8UnlockBegin = r.bool("chapter8UnlockBegin");
    result.chapter8UnlockSecondPhase = r.bool("chapter8UnlockSecondPhase");
    result.chapter8Passed = r.bool("chapter8Passed");
    result.chapter8SongUnlocked = r.u8("chapter8SongUnlocked");
  }
  if (version >= 4) result.flagOfSongRecordKeyTakumi = r.u8("flagOfSongRecordKeyTakumi");
  r.finish();
  return result;
}

export function countLevels(songs: SongRecord[]) {
  return LEVELS.map((_, level) => ({
    cleared: songs.filter((song) => (song.levels[level]?.accuracy ?? 0) > 0).length,
    fc: songs.filter((song) => (song.levels[level]?.accuracy ?? 0) > 0 && (song.fc >> level) & 1)
      .length,
    phi: songs.filter((song) => (song.levels[level]?.accuracy ?? 0) >= 100).length,
  }));
}
