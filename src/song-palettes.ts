import { catalogSong } from "./catalog";
import data from "./palettes.json";

/** Nine fog colours per song (3×3 grid, row by row), derived from its cover by scripts/build-palettes.ts. */
const palettes = data as Record<string, string[]>;

export function songPalette(songId: string): string[] | undefined {
  const song = catalogSong(songId);
  return song ? palettes[song.id] : undefined;
}
