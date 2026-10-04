import data from "./catalog.json";
import { LEVELS } from "./modules";

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

export const catalogManifest = data.manifest;
export const catalogRevision = `${data.manifest.gameVersion}-${data.manifest.sourceRevision.slice(0, 8)}`;
const aliases = data.aliases as Record<string, string>;
const songs = new Map((data.songs as CatalogSong[]).map((song) => [song.id, song]));

/** Chapter labels as they were before a rename (e.g. the Chinese subtitles of builds ≤ 154), mapped to today's. */
const chapterAliases = (data as { chapterAliases?: Record<string, string> }).chapterAliases ?? {};
export function canonicalChapter(label: string): string {
  return chapterAliases[label] ?? label;
}
/** A chapter's label and every label it had before, so text search still finds it by its old name. */
const chapterSearch = new Map<string, string>();
for (const [old, label] of Object.entries(chapterAliases))
  chapterSearch.set(label, `${chapterSearch.get(label) ?? label} ${old}`);
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

export function catalogCompatible(gameVersion?: number): boolean {
  return gameVersion === undefined || gameVersion === data.manifest.gameVersion;
}

export function unknownSongIds(ids: string[]): string[] {
  return [...new Set(ids.filter((id) => !catalogSong(id)))].sort();
}

export const catalogSongs = data.songs as CatalogSong[];

/** Defined charts per difficulty across the whole catalog. */
export const catalogChartTotals = LEVELS.map(
  (_, level) => catalogSongs.filter((song) => song.constants[level] !== null).length,
);

/** Catalog charts without a played record, per difficulty. */
export function missingCharts(
  songs: { songId: string; levels: (null | object)[] }[],
): { id: string; title: string }[][] {
  const played = new Set(
    songs.flatMap((song) =>
      song.levels.flatMap((record, level) =>
        record ? [`${canonicalSongId(song.songId)}:${level}`] : [],
      ),
    ),
  );
  return LEVELS.map((_, level) =>
    catalogSongs
      .filter((song) => song.constants[level] !== null && !played.has(`${song.id}:${level}`))
      .map((song) => ({ id: song.id, title: song.title })),
  );
}
