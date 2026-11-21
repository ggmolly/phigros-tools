import type { CSSProperties } from "react";
import { activeMods, type ModId, multiplierOf } from "../modifiers";

/**
 * Each modifier's glyph, path data stroked in a 24 by 24 box: the ones Phigros++ draws in the game
 * (`mod/phigrospp/lua/modifiers.lua`).
 */
export const MOD_PATHS: Record<ModId, string> = {
  EZ: "M9 7 4 12l5 5M15 7l5 5-5 5M10 12h4",
  HR: "M4 7l5 5-5 5M20 7l-5 5 5 5M12 9v6",
  HT: "M7 5v14M11 6l8 6-8 6z",
  NC: "M4 7l5 5-5 5M11 7l5 5-5 5M20 7v10",
  HD: "M2 12s3.6-6 10-6 10 6 10 6-3.6 6-10 6S2 12 2 12M9.5 12a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0M4 4l16 16",
  FL: "M2 12h20M12 8V4M12 20v-4M6 8 4.5 5.5M18 8l1.5-2.5M6 16l-1.5 2.5M18 16l1.5 2.5",
  SD: "M13 2 4 14h7l-1 8 9-12h-7z",
  PF: "M6 12a6 6 0 1 0 12 0a6 6 0 1 0-12 0M12 3v18",
  RD: "M3 7h4l10 10h4M3 17h4l10-10h4M18 4l3 3-3 3M18 14l3 3-3 3",
};
/** The plates' colours by kind (easier, harder, neither), osu!'s. */
export const MOD_COLORS = ["#b2ff66", "#ff6666", "#8c66ff"];

/** What the modifiers make of the score: ×1.19. */
export const multiplierLabel = (mods: number) => `×${multiplierOf(mods).toFixed(2)}`;

/** The modifiers a score was played with, a small plate each, named on hover. Nothing without any. */
export function Modifiers({ mods }: { mods: number }) {
  if (!mods) return null;
  return (
    <span className="modifiers">
      {activeMods(mods).map(([, id, name, percent, kind]) => (
        <svg
          key={id}
          className="modifier"
          viewBox="0 0 24 24"
          role="img"
          style={{ "--tint": MOD_COLORS[kind] } as CSSProperties}
        >
          <title>{percent === 100 ? name : `${name} ×${(percent / 100).toFixed(2)}`}</title>
          <path d={MOD_PATHS[id]} />
        </svg>
      ))}
    </span>
  );
}
