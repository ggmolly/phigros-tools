/**
 * The fog when no song is selected: Spasmodic's cover colours, copied from palettes.json so every page
 * doesn't ship all songs' palettes (those load on demand from song-palettes.ts). Nine colours, 3×3 grid, row by row.
 */
// ponytail: copied by hand; re-copy palettes.json["Spasmodic.姜米條颶風元力上人"] if scripts/build-palettes.ts changes.
export const DEFAULT_PALETTE = [
  "#414250",
  "#562e3d",
  "#37444f",
  "#52373c",
  "#533343",
  "#473243",
  "#2e5064",
  "#4c3750",
  "#3b3950",
];

/** A palette as `--fog-N` custom properties, for the server-rendered `<html style>`. */
export function fogStyle(palette = DEFAULT_PALETTE): Record<string, string> {
  return Object.fromEntries(palette.map((color, index) => [`--fog-${index}`, color]));
}

/** Tints the page background with a song's colours; with no palette it goes back to the default fog. */
export function applyPalette(palette: string[] | undefined) {
  const style = document.documentElement.style;
  (palette ?? DEFAULT_PALETTE).forEach((color, index) => {
    style.setProperty(`--fog-${index}`, color);
  });
}

/** Where each of the nine colours sits: [x, y, radiusX, radiusY] as fractions of the page. Mirrors `.backdrop` in style.css. */
export const FOG_LAYOUT: [number, number, number, number][] = [
  [0, 0, 0.55, 0.6],
  [0.5, -0.06, 0.5, 0.5],
  [1, 0, 0.55, 0.6],
  [-0.04, 0.5, 0.45, 0.55],
  [0.5, 0.45, 0.55, 0.5],
  [1.04, 0.5, 0.45, 0.55],
  [0, 1, 0.55, 0.6],
  [0.5, 1.06, 0.5, 0.5],
  [1, 1, 0.55, 0.6],
];

/** The background's current nine colours: the selected song's palette, or the default fog. */
export function currentPalette(): string[] {
  const style = document.documentElement.style;
  return DEFAULT_PALETTE.map(
    (fallback, index) => style.getPropertyValue(`--fog-${index}`) || fallback,
  );
}
