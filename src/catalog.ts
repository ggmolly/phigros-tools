import { onGame } from "./game";
import { LEVELS, type LevelName } from "./modules";

export interface CatalogSong {
  id: string;
  title: string;
  artist: string;
  /** Latin spellings (pinyin, romaji) of the Chinese or Japanese in the title and artist, for search. */
  romanized?: string[];
  illustrator?: string;
  chapter: string;
  constants: (number | null)[];
  charters: (string | null)[];
}

/** catalog.json, made by scripts/build-catalog.ts */
export interface CatalogFile {
  manifest: { gameVersion: number; sourceRevision: string };
  aliases: Record<string, string>;
  /** Chapter labels as they were before a rename (e.g. the Chinese subtitles of builds ≤ 154), mapped to today's. */
  chapterAliases?: Record<string, string>;
  songs: CatalogSong[];
}

export let catalogManifest: CatalogFile["manifest"];
export let catalogRevision: string;
export let catalogSongs: CatalogSong[];
/** Defined charts per difficulty across the whole catalog. */
export let catalogChartTotals: number[];
let aliases: Record<string, string>;
let songs: Map<string, CatalogSong>;
let chapterAliases: Record<string, string>;
/** A chapter's label and every label it had before, so text search still finds it by its old name. */
let chapterSearch: Map<string, string>;

/** The catalog's game build and the start of its source's hash: what caches made from the catalog are keyed by. */
export const revisionOf = (manifest: CatalogFile["manifest"]) =>
  `${manifest.gameVersion}-${manifest.sourceRevision.slice(0, 8)}`;

onGame(({ catalog }) => {
  catalogManifest = catalog.manifest;
  catalogRevision = revisionOf(catalog.manifest);
  catalogSongs = catalog.songs;
  catalogChartTotals = LEVELS.map(
    (_, level) => catalogSongs.filter((song) => song.constants[level] !== null).length,
  );
  aliases = catalog.aliases;
  songs = new Map(catalog.songs.map((song) => [song.id, song]));
  chapterAliases = catalog.chapterAliases ?? {};
  chapterSearch = new Map();
  for (const [old, label] of Object.entries(chapterAliases))
    chapterSearch.set(label, `${chapterSearch.get(label) ?? label} ${old}`);
});

export function canonicalChapter(label: string): string {
  return chapterAliases[label] ?? label;
}
export function chapterSearchText(label: string): string {
  return chapterSearch.get(label) ?? label;
}

/**
 * Text for search, lowercased and without accents, spaces or punctuation: "Jiang Mitiao" matches "jiangmitiao" and a
 * query is folded the same way. Fields stay apart so a query can't match across two of them.
 */
export function searchFold(...fields: (string | undefined)[]): string {
  return fields
    .filter(Boolean)
    .map((field) =>
      field!
        .normalize("NFKD")
        .replace(/(\p{Script=Latin})\p{M}+/gu, "$1")
        .toLocaleLowerCase()
        .replace(/[^\p{L}\p{M}\p{N}]+/gu, ""),
    )
    .join(" ");
}

export function canonicalSongId(id: string): string {
  return aliases[id] ?? id;
}

export function catalogSong(id: string): CatalogSong | undefined {
  return songs.get(canonicalSongId(id));
}

/** The difficulties a song has charts for. */
export const songLevels = (id: string) =>
  LEVELS.filter((_, index) => catalogSong(id)?.constants[index] != null);

export const isLevel = (level: string): level is LevelName => LEVELS.includes(level as LevelName);

export function catalogCompatible(gameVersion?: number): boolean {
  return gameVersion === undefined || gameVersion === catalogManifest.gameVersion;
}

export function unknownSongIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => !catalogSong(id)))].sort();
}
