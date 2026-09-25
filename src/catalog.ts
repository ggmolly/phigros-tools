import data from "./catalog.json";
import { LEVELS } from "./modules";

export interface CatalogSong {
  id: string;
  title: string;
  artist: string;
  illustrator?: string;
  chapter: string;
  constants: (number | null)[];
  charters: (string | null)[];
}

export const catalogManifest = data.manifest;
export const catalogRevision = `${data.manifest.gameVersion}-${data.manifest.sourceRevision.slice(0, 8)}`;
const aliases = data.aliases as Record<string, string>;
const songs = new Map((data.songs as CatalogSong[]).map((song) => [song.id, song]));

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
