import { createServerFn } from "@tanstack/react-start";
import { canonicalSongId } from "./catalog";
import { game } from "./game";

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

/**
 * One song's per-difficulty chart stats (EZ/HD/IN/AT order, derived from the game's own chart files, see
 * scripts/build-chart-stats.ts) and theme colour. A server function: the browser never gets the stats.
 */
export const getSongDetails = createServerFn({ method: "GET" })
  .validator((songId: string) => songId)
  .handler(({ data: songId }) => {
    const id = canonicalSongId(songId);
    return {
      stats: game().chartStats![id] ?? null,
      themeColor: game().accents![id], // the cover's dominant colour, see scripts/build-accents.ts
    };
  });
