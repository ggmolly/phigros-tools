import { createServerFn } from "@tanstack/react-start";
import accents from "./accents.json";
import { canonicalSongId } from "./catalog";
import data from "./chart-stats.json";

export interface ChartStats {
  notes: number;
  tap: number;
  drag: number;
  hold: number;
  flick: number;
  above: number;
  below: number;
  lines: number;
  lengthSec: number;
  avgNps: number;
  peakNps: number;
  maxChord: number;
  chordCount: number;
  holdSec: number;
  bpm: number;
  bpmMin: number;
  bpmMax: number;
  speedMin: number;
  speedMax: number;
  speedChanges: number;
  motionEvents: number;
  longestGapSec: number;
}

const songs = data.songs as Record<string, (ChartStats | null)[]>;

/**
 * One song's per-difficulty chart stats (EZ/HD/IN/AT order, derived from the game's own chart files, see
 * scripts/build-chart-stats.ts) and theme colour. A server function so the stats JSON stays out of the client bundle.
 */
export const getSongDetails = createServerFn({ method: "GET" })
  .validator((songId: string) => songId)
  .handler(({ data: songId }) => {
    const id = canonicalSongId(songId);
    return {
      stats: (songs[id] ?? null) as (ChartStats | null)[] | null,
      themeColor: (accents as Record<string, string>)[id], // the cover's dominant colour, see scripts/build-accents.ts
    };
  });
