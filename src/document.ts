import * as v from "valibot";
import type {
  GameKey,
  GameProgress,
  ModuleName,
  Profile,
  Settings,
  SongRecord,
  Summary,
} from "./modules";

export interface SaveDocumentV1 {
  schema: "phigros-web-save";
  schemaVersion: 1;
  source: {
    kind: "cloud" | "zip" | "json";
    importedAt: string;
    name?: string;
    cloudUpdatedAt?: string;
  };
  moduleVersions: Record<ModuleName, number>;
  summary?: Summary;
  profile?: Profile;
  settings?: Settings;
  gameKey: GameKey;
  gameProgress: GameProgress;
  songs: SongRecord[];
}

export const MAX_JSON_SIZE = 20_000_000;
const shortString = v.pipe(v.string(), v.maxLength(512));
const isoString = v.pipe(v.string(), v.maxLength(64));
const byte = v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(255));
const nonNegativeInt = v.pipe(v.number(), v.integer(), v.minValue(0));
const levelRecord = v.object({
  score: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1_000_000)),
  accuracy: v.pipe(v.number(), v.minValue(0), v.maxValue(100)),
});
const levels = v.tuple([
  v.nullable(levelRecord),
  v.nullable(levelRecord),
  v.nullable(levelRecord),
  v.nullable(levelRecord),
]);
const song = v.object({
  rawSongId: shortString,
  songId: shortString,
  fc: byte,
  levels,
});
const count = v.object({ cleared: nonNegativeInt, fc: nonNegativeInt, phi: nonNegativeInt });
const counts = v.tuple([count, count, count, count]);
const summary = v.object({
  saveVersion: byte,
  gameVersion: nonNegativeInt,
  challengeModeRank: v.pipe(v.number(), v.integer()),
  rankingScore: v.pipe(v.number(), v.minValue(0), v.maxValue(30)),
  avatar: shortString,
  counts,
});
const profile = v.object({
  idShown: v.boolean(),
  intro: shortString,
  avatar: shortString,
  background: shortString,
});
const settings = v.object({
  chordSupport: v.boolean(),
  fcAPIndicator: v.boolean(),
  enableHitSound: v.boolean(),
  lowResolutionMode: v.boolean(),
  device: shortString,
  brightness: v.number(),
  musicVolume: v.number(),
  effectVolume: v.number(),
  hitSoundVolume: v.number(),
  offset: v.number(),
  noteScale: v.number(),
});
const gameKey = v.object({
  entries: v.pipe(
    v.array(
      v.object({
        key: shortString,
        valueFlags: byte,
        values: v.pipe(v.array(v.nullable(byte)), v.length(5)),
      }),
    ),
    v.maxLength(10_000),
  ),
  lanotaReadKeys: byte,
  camelliaReadKey: v.optional(v.boolean()),
  sideStory4BeginReadKey: v.optional(byte),
  oldScoreClearedV390: v.optional(byte),
});
const gameProgress = v.object({
  isFirstRun: v.boolean(),
  legacyChapterFinished: v.boolean(),
  alreadyShowCollectionTip: v.boolean(),
  alreadyShowAutoUnlockINTip: v.boolean(),
  completed: shortString,
  songUpdateInfo: byte,
  challengeModeRank: v.pipe(v.number(), v.integer()),
  money: v.pipe(v.array(nonNegativeInt), v.length(5)),
  unlockFlagOfSpasmodic: byte,
  unlockFlagOfIgallta: byte,
  unlockFlagOfRrharil: byte,
  flagOfSongRecordKey: byte,
  randomVersionUnlocked: v.optional(byte),
  chapter8UnlockBegin: v.optional(v.boolean()),
  chapter8UnlockSecondPhase: v.optional(v.boolean()),
  chapter8Passed: v.optional(v.boolean()),
  chapter8SongUnlocked: v.optional(byte),
  flagOfSongRecordKeyTakumi: v.optional(byte),
});
const moduleVersions = v.object({
  gameKey: byte,
  gameProgress: byte,
  gameRecord: byte,
  settings: byte,
  user: byte,
});
const saveDocument = v.object({
  schema: v.literal("phigros-web-save"),
  schemaVersion: v.literal(1),
  source: v.object({
    kind: v.picklist(["cloud", "zip", "json"]),
    importedAt: isoString,
    name: v.optional(shortString),
    cloudUpdatedAt: v.optional(isoString),
  }),
  moduleVersions,
  summary: v.optional(summary),
  profile: v.optional(profile),
  settings: v.optional(settings),
  gameKey,
  gameProgress,
  songs: v.pipe(v.array(song), v.maxLength(10_000)),
});
function uniqueSongs(songs: { songId: string }[]) {
  const seen = new Set<string>();
  for (const song of songs) {
    if (seen.has(song.songId)) throw new Error(`duplicate song ID ${JSON.stringify(song.songId)}`);
    seen.add(song.songId);
  }
}

function decodeJson(text: string): unknown {
  if (new Blob([text]).size > MAX_JSON_SIZE)
    throw new Error(`JSON exceeds the ${MAX_JSON_SIZE / 1_000_000} MB import limit`);
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("Invalid JSON");
  }
}

function validationError(result: {
  issues?: readonly { message: string; path?: readonly { key: unknown }[] }[];
}): never {
  const issue = result.issues?.[0];
  const path = issue?.path?.map(({ key }) => String(key)).join(".");
  throw new Error(
    `Invalid import${path ? ` at ${path}` : ""}: ${issue?.message ?? "schema mismatch"}`,
  );
}

export function parseJsonDocument(text: string): SaveDocumentV1 {
  const result = v.safeParse(saveDocument, decodeJson(text));
  if (!result.success) validationError(result);
  uniqueSongs(result.output.songs);
  return result.output as SaveDocumentV1;
}
