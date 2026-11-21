import { ParseError, Reader, Writer } from "./binary";

/** The newest module version this build parses. The game only ever appends fields on a version bump, so a
 * newer module is parsed leniently (strict tail check skipped); a version below the minimum can't be read. */
export const PARSEABLE_VERSIONS: Record<ModuleName, number> = {
  gameKey: 3,
  gameProgress: 6,
  gameRecord: 1,
  settings: 1,
  user: 1,
};

export const LEVELS = ["EZ", "HD", "IN", "AT"] as const;
export type LevelName = (typeof LEVELS)[number];
/** Each level's colour, as `--ez`... in base.css, for what the stylesheet doesn't reach (cards, Discord). */
export const LEVEL_COLORS: Record<string, string> = {
  EZ: "#4aa84a",
  HD: "#3a78c0",
  IN: "#c43a33",
  AT: "#4a4a52",
};
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
  /** gameProgress v5 (Phigros 4.0.0): the two bools share one byte, and the tiers are nibbles of one byte. */
  chapter9UnlockBegin?: boolean;
  chapter9SecretChallengePendingLifeUnlock?: boolean;
  chapter9SongUnlocked?: number;
  chapter9SecretChallengeLifeTier?: number;
  chapter9SecretChallengeSelectedLifeTier?: number;
  chapter9SecretPassword?: string;
  /** gameProgress v6 (Phigros 4.0.1): the three bools share one byte. */
  chapter9Phase2SongUnlocked?: number;
  chapter9Phase2Begin?: boolean;
  chapter9Phase2Passed?: boolean;
  c9BaselineChallengeReached?: boolean;
  chapter9Phase2Step?: number;
}

function supported(module: ModuleName, version: number, min: number, max = min, lenient = false) {
  if (version < min || (version > max && !lenient)) {
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

export function encodeSummary(summary: Summary): string {
  const w = new Writer();
  w.u8(summary.saveVersion);
  w.i16(summary.challengeModeRank);
  w.f32(summary.rankingScore);
  w.varshort(summary.gameVersion);
  w.string(summary.avatar);
  for (const count of summary.counts) {
    w.i16(count.cleared);
    w.i16(count.fc);
    w.i16(count.phi);
  }
  return w.finish().toBase64();
}

export function parseGameRecord(bytes: Uint8Array, version: number, lenient = false): SongRecord[] {
  supported("gameRecord", version, 1, PARSEABLE_VERSIONS.gameRecord, lenient);
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
  if (!lenient) r.finish();
  return songs;
}

export function writeGameRecord(songs: SongRecord[]): Uint8Array {
  const w = new Writer();
  w.varshort(songs.length);
  for (const song of songs) {
    w.string(song.rawSongId);
    const body = new Writer();
    body.u8(song.levels.reduce((flags, record, level) => flags | (record ? 1 << level : 0), 0));
    body.u8(song.fc);
    for (const record of song.levels) {
      if (!record) continue;
      body.i32(record.score);
      body.f32(record.accuracy);
    }
    const bytes = body.finish();
    w.u8(bytes.length);
    w.bytes(bytes);
  }
  return w.finish();
}

export function parseProfile(bytes: Uint8Array, version: number, lenient = false): Profile {
  supported("user", version, 1, PARSEABLE_VERSIONS.user, lenient);
  const r = new Reader(bytes, "user");
  const profile = {
    idShown: r.bool("showPlayerId"),
    intro: r.string("selfIntro"),
    avatar: r.string("avatar"),
    background: r.string("background"),
  };
  if (!lenient) r.finish();
  return profile;
}

export function writeProfile(profile: Profile): Uint8Array {
  const w = new Writer();
  w.bool(profile.idShown);
  w.string(profile.intro);
  w.string(profile.avatar);
  w.string(profile.background);
  return w.finish();
}

export function parseSettings(bytes: Uint8Array, version: number, lenient = false): Settings {
  supported("settings", version, 1, PARSEABLE_VERSIONS.settings, lenient);
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
  if (!lenient) r.finish();
  return settings;
}

export function writeSettings(settings: Settings): Uint8Array {
  const w = new Writer();
  w.bool(settings.chordSupport);
  w.bool(settings.fcAPIndicator);
  w.bool(settings.enableHitSound);
  w.bool(settings.lowResolutionMode);
  w.string(settings.device);
  w.f32(settings.brightness);
  w.f32(settings.musicVolume);
  w.f32(settings.effectVolume);
  w.f32(settings.hitSoundVolume);
  w.f32(settings.offset);
  w.f32(settings.noteScale);
  return w.finish();
}

export function parseGameKey(bytes: Uint8Array, version: number, lenient = false): GameKey {
  supported("gameKey", version, 1, PARSEABLE_VERSIONS.gameKey, lenient);
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
  if (!lenient) r.finish();
  return result;
}

export function writeGameKey(gameKey: GameKey, version = PARSEABLE_VERSIONS.gameKey): Uint8Array {
  const w = new Writer();
  w.varshort(gameKey.entries.length);
  for (const entry of gameKey.entries) {
    w.string(entry.key);
    const values = entry.values.filter((value) => value !== null);
    w.u8(1 + values.length);
    w.u8(entry.valueFlags);
    for (const value of values) w.u8(value);
  }
  w.u8(gameKey.lanotaReadKeys);
  if (version >= 2) w.bool(gameKey.camelliaReadKey ?? false);
  if (version >= 3) {
    w.u8(gameKey.sideStory4BeginReadKey ?? 0);
    w.u8(gameKey.oldScoreClearedV390 ?? 0);
  }
  return w.finish();
}

export function parseGameProgress(
  bytes: Uint8Array,
  version: number,
  lenient = false,
): GameProgress {
  supported("gameProgress", version, 1, PARSEABLE_VERSIONS.gameProgress, lenient);
  const r = new Reader(bytes, "gameProgress");
  const result: GameProgress = {
    isFirstRun: r.bool("isFirstRun"),
    legacyChapterFinished: r.bool("legacyChapterFinished"),
    alreadyShowCollectionTip: r.bool("alreadyShowCollectionTip"),
    alreadyShowAutoUnlockINTip: r.bool("alreadyShowAutoUnlockINTip"),
    completed: r.string("completed"),
    songUpdateInfo: r.varshort("songUpdateInfo"),
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
  if (version >= 5) {
    const chapter9Flags = r.u8("chapter9Flags");
    result.chapter9UnlockBegin = (chapter9Flags & 1) === 1;
    result.chapter9SecretChallengePendingLifeUnlock = (chapter9Flags & 2) === 2;
    result.chapter9SongUnlocked = r.u8("chapter9SongUnlocked");
    const tiers = r.u8("chapter9SecretChallengeTiers");
    result.chapter9SecretChallengeLifeTier = tiers & 0xf;
    result.chapter9SecretChallengeSelectedLifeTier = tiers >> 4;
    result.chapter9SecretPassword = r.string("chapter9SecretPassword");
  }
  if (version >= 6) {
    result.chapter9Phase2SongUnlocked = r.u8("chapter9Phase2SongUnlocked");
    const phase2Flags = r.u8("chapter9Phase2Flags");
    result.chapter9Phase2Begin = (phase2Flags & 1) === 1;
    result.chapter9Phase2Passed = (phase2Flags & 2) === 2;
    result.c9BaselineChallengeReached = (phase2Flags & 4) === 4;
    result.chapter9Phase2Step = r.u8("chapter9Phase2Step");
  }
  if (!lenient) r.finish();
  return result;
}

export function writeGameProgress(
  progress: GameProgress,
  version = PARSEABLE_VERSIONS.gameProgress,
): Uint8Array {
  const w = new Writer();
  w.bool(progress.isFirstRun);
  w.bool(progress.legacyChapterFinished);
  w.bool(progress.alreadyShowCollectionTip);
  w.bool(progress.alreadyShowAutoUnlockINTip);
  w.string(progress.completed);
  w.varshort(progress.songUpdateInfo);
  w.i16(progress.challengeModeRank);
  for (const amount of progress.money) w.varshort(amount);
  w.u8(progress.unlockFlagOfSpasmodic);
  w.u8(progress.unlockFlagOfIgallta);
  w.u8(progress.unlockFlagOfRrharil);
  w.u8(progress.flagOfSongRecordKey);
  if (version >= 2) w.u8(progress.randomVersionUnlocked ?? 0);
  if (version >= 3) {
    w.bool(progress.chapter8UnlockBegin ?? false);
    w.bool(progress.chapter8UnlockSecondPhase ?? false);
    w.bool(progress.chapter8Passed ?? false);
    w.u8(progress.chapter8SongUnlocked ?? 0);
  }
  if (version >= 4) w.u8(progress.flagOfSongRecordKeyTakumi ?? 0);
  if (version >= 5) {
    w.bool(progress.chapter9UnlockBegin ?? false);
    w.bool(progress.chapter9SecretChallengePendingLifeUnlock ?? false);
    w.u8(progress.chapter9SongUnlocked ?? 0);
    // the life tiers start at 1 in the game
    w.u8(
      (progress.chapter9SecretChallengeLifeTier ?? 1) |
        ((progress.chapter9SecretChallengeSelectedLifeTier ?? 1) << 4),
    );
    w.string(progress.chapter9SecretPassword ?? "0");
  }
  if (version >= 6) {
    w.u8(progress.chapter9Phase2SongUnlocked ?? 0);
    w.bool(progress.chapter9Phase2Begin ?? false);
    w.bool(progress.chapter9Phase2Passed ?? false);
    w.bool(progress.c9BaselineChallengeReached ?? false);
    w.u8(progress.chapter9Phase2Step ?? 0);
  }
  return w.finish();
}

/** A save's records as Phigros++ sends them, one per line (see server/records.ts). */
export function recordLines(songs: SongRecord[]): string {
  return songs
    .flatMap((song) =>
      song.levels.map(
        (record, level) =>
          record &&
          `${song.rawSongId}\t${LEVELS[level]}\t${record.score}\t${record.accuracy.toFixed(4)}\t${(song.fc >> level) & 1}`,
      ),
    )
    .filter(Boolean)
    .join("\n");
}

export function countLevels(songs: Pick<SongRecord, "fc" | "levels">[]) {
  return LEVELS.map((_, level) => ({
    cleared: songs.filter((song) => (song.levels[level]?.accuracy ?? 0) > 0).length,
    fc: songs.filter((song) => (song.levels[level]?.accuracy ?? 0) > 0 && (song.fc >> level) & 1)
      .length,
    phi: songs.filter((song) => (song.levels[level]?.accuracy ?? 0) >= 100).length,
  }));
}
