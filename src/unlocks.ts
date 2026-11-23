import type { SaveDocumentV1 } from "./document";
import { onGame } from "./game";
import type { GameKey, GameProgress, SongRecord } from "./modules";

/**
 * What a save rebuilt on the site unlocks. The game keeps its unlocks as prefs, which a save holds as keys (songs
 * bought, collection items, illustrations, avatars) and as bits of its progress. Loading a save clears every pref
 * first, so whatever it lacks is locked: a record alone doesn't make its chart playable.
 */

/** The kinds of key, in the game's order (Key.kindOfKey). A key's value sits one slot after its kind's index. */
export const KEY_KINDS = ["song", "collection", "illustration", "avatar"] as const;
/** keys.json, made by scripts/build-keys.ts */
export interface KeysFile {
  keys: Record<string, number>[];
  songKeys: Record<string, string>;
  gates: Record<string, string[][]>;
  chapters: { songs: string[]; gate: string | number; score: number }[];
  legacy: string[];
}
/** Every key of each kind, and how many times it's found to be whole. */
export let KEYS: KeysFile["keys"];
let songKeys: KeysFile["songKeys"];
let gates: KeysFile["gates"];
let chapters: KeysFile["chapters"];
let legacy: KeysFile["legacy"];
onGame(({ keys }) => {
  ({ keys: KEYS, songKeys, gates, chapters, legacy } = keys);
});

type Save = Pick<SaveDocumentV1, "gameKey" | "gameProgress">;
/** Where a save holds a pref: the module, its field, and the field's bit (true for a field of its own). */
type Place = [keyof Save, keyof GameProgress | keyof GameKey, number | true];

/** The prefs a field holds, one per bit from the lowest. */
const bits = (field: Place[1], prefs: string[]): [string, Place][] =>
  prefs.map((pref, bit) => [pref, ["gameProgress", field, 1 << bit]]);

/** The songs of chapter 8 in its order, which is the order of their bits. */
export const CHAPTER_8 = [
  "C8CraveWaveUnlocked",
  "C8TheChariotREVIIVALUnlocked",
  "C8LuminescenceUnlocked",
  "C8RetributionUnlocked",
  "C8DESTRUCTION321Unlocked",
  "C8DistortedFateUnlocked",
];

/** Each pref that gates a chart (GameProgressSaveModule and GameKeySaveModule). */
export const PREFS: Record<string, Place> = Object.fromEntries<Place>([
  ...(["Spasmodic", "Igallta", "Rrharil"] as const).flatMap((song) =>
    bits(
      `unlockFlagOf${song}`,
      ["EZ", "HD", "IN"].map((level) => `unlockFlagOf${song}${level}`),
    ),
  ),
  ...bits("chapter8SongUnlocked", CHAPTER_8),
  ...bits("chapter9SongUnlocked", [
    "C9ImplexroughUnlocked",
    "C9AboutTheUniverseUnlocked",
    "C9EvanescentUnlocked",
    "C9ExoplanetaryMirageUnlocked",
    "C9EntranceToTheChaosUnlocked",
    "C9S6Unlocked",
  ]),
  ...bits("chapter9Phase2SongUnlocked", [
    "C9AmetrineUnlocked",
    "C9PetrichorUnlocked",
    "C9HateUnlocked",
    "C9DesultorySignalsUnlocked",
    "C9MessageUnlocked",
    "C9HappyEndingUnlocked",
  ]),
  // an S on the song's IN chart, which the game notes once
  ...bits("flagOfSongRecordKey", [
    "YouaretheMiserableINSGrade",
    "StasisINSGrade",
    "ShadowINSGrade",
    "心之所向INSGrade",
    "inferiorINSGrade",
    "DESTRUCTION321INSGrade",
    "DistortedFateINSGrade",
  ]),
  ...bits("flagOfSongRecordKeyTakumi", [
    "CuvismINSGrade",
    "iLArtifactINSGrade",
    "atruthseekerCommunicationwithUtopiawillbelostINSGrade",
  ]),
  ["chapter8Passed", ["gameProgress", "chapter8Passed", true]],
  ["Chapter9Phase2Passed", ["gameProgress", "chapter9Phase2Passed", true]],
  // the stories read in the collection: Lanota's are bits 1 to 5
  ...[1, 2, 3, 4, 5].map((story): [string, Place] => [
    `ReadLanota${story}`,
    ["gameKey", "lanotaReadKeys", 1 << story],
  ]),
  ["ReadbassareusEgg", ["gameKey", "camelliaReadKey", true]],
  ["ReadSideStory4Begin", ["gameKey", "sideStory4BeginReadKey", 1]],
]);

/** Sets a pref where the save holds it. */
export function openPref(save: Save, pref: string) {
  const [module, field, bit] = PREFS[pref]!;
  const fields = save[module] as unknown as Record<string, number | boolean | undefined>;
  fields[field] = bit === true || Number(fields[field] ?? 0) | bit;
}

const S_GRADE = 920_000;

export const hasKey = (keys: GameKey, kind: number, name: string) =>
  ((keys.entries.find((entry) => entry.key === name)?.valueFlags ?? 0) & (2 << kind)) !== 0;

/** Gives or takes a key, whole. One entry holds the keys of every kind that share its name. */
export function setKey(keys: GameKey, kind: number, name: string, on: boolean) {
  let entry = keys.entries.find((e) => e.key === name);
  if (!entry) {
    if (!on) return;
    entry = { key: name, valueFlags: 0, values: [null, null, null, null, null] };
    keys.entries.push(entry);
  }
  entry.values[kind + 1] = on ? KEYS[kind]![name]! : null;
  entry.valueFlags = on ? entry.valueFlags | (2 << kind) : entry.valueFlags & ~(2 << kind);
  if (!entry.valueFlags) keys.entries.splice(keys.entries.indexOf(entry), 1);
}

/**
 * The chapters a save has records in that the game keeps locked. It opens a chapter on scores alone, each time its
 * chapter list shows: a chart of the gate song reaching the score, or as many charts of the Legacy chapter as the gate
 * says. Each comes with one of its songs, and how many charts reach the score so far.
 */
export function lockedChapters(songs: SongRecord[]) {
  const reaching = (ids: string[], score: number) =>
    songs
      .filter((song) => ids.includes(song.songId))
      .flatMap((song) => song.levels)
      .filter((record) => record && record.score >= score).length;
  return chapters
    .filter((chapter) => songs.some((song) => chapter.songs.includes(song.songId)))
    .map(({ songs: [song], gate, score }) => ({
      song: song!,
      gate,
      score,
      have: reaching(typeof gate === "number" ? legacy : [gate], score),
    }))
    .filter(({ gate, have }) => have < (typeof gate === "number" ? gate : 1));
}

/**
 * The save with what it needs to be played as it reads: the key of each song that has a record, the gates of each
 * chart that has one, and the avatar of the profile (its background is a song's id, and needs no key). What opens a
 * chapter isn't in a save: see lockedChapters.
 */
export function unlock(document: SaveDocumentV1): SaveDocumentV1 {
  const save = structuredClone(document);
  const { gameKey, gameProgress: progress, profile } = save;
  for (const song of save.songs) {
    const key = songKeys[song.songId];
    if (key) setKey(gameKey, 0, key, true);
    song.levels.forEach((record, level) => {
      if (record) for (const pref of gates[song.songId]?.[level] ?? []) openPref(save, pref);
    });
    const grade = `${song.songId.split(".")[0]}INSGrade`;
    if (grade in PREFS && (song.levels[2]?.score ?? 0) >= S_GRADE) openPref(save, grade);
  }
  if (profile?.avatar) setKey(gameKey, 3, profile.avatar, true);
  // a song of chapters 8 and 9 is unlocked along their story, which has begun for a save that has one
  const chapter8 = progress.chapter8SongUnlocked ?? 0;
  const chapter9 = progress.chapter9SongUnlocked ?? 0;
  if (chapter8) progress.chapter8UnlockBegin = true;
  if (chapter8 >> 4) progress.chapter8UnlockSecondPhase = true;
  if (chapter9 || progress.chapter9Phase2SongUnlocked) progress.chapter9UnlockBegin = true;
  if (progress.chapter9Phase2SongUnlocked) progress.chapter9Phase2Begin = true;
  // the last song of chapter 9's first half stays hidden until its second half has a step
  if (chapter9 >> 5) progress.chapter9Phase2Step ||= 1;
  return save;
}
