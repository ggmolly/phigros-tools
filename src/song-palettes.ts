import { catalogSong } from "./catalog";
import { game } from "./game";

/** Nine fog colours per song (3×3 grid, row by row), derived from its cover by scripts/build-palettes.ts. */
export function songPalette(songId: string): string[] | undefined {
  const song = catalogSong(songId);
  return song ? game().palettes[song.id] : undefined;
}
