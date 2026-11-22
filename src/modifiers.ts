import type { RawChart } from "./player/chart";

/**
 * The modifiers a song can be played with in Phigros++ (`mod/phigrospp/lua/modifiers.lua`, which this file is read
 * alongside: the game and the site must agree on every rule). A replay's `mods` holds their bits, osu!'s values. Each
 * is [bit, acronym, name, percent of the score it gives, kind: 0 easier, 1 harder, 2 neither].
 */
export const MODS = [
  [2, "EZ", "Easy", 50, 0],
  [16, "HR", "Hard Rock", 106, 1],
  [256, "HT", "Half Time", 30, 0],
  [512, "NC", "Nightcore", 112, 1],
  [8, "HD", "Hidden", 106, 1],
  [1024, "FL", "Flashlight", 112, 1],
  [32, "SD", "Sudden Death", 100, 1],
  [16384, "PF", "Perfect", 100, 1],
  [2097152, "RD", "Random", 100, 2],
] as const;
export type ModId = (typeof MODS)[number][1];
export const Mod = Object.fromEntries(MODS.map(([bit, id]) => [id, bit])) as Record<ModId, number>;

const ALL = MODS.reduce((mask, [bit]) => mask | bit, 0);
// the ones that can't go together
const PAIRS = [Mod.EZ | Mod.HR, Mod.HT | Mod.NC, Mod.SD | Mod.PF];

/** Whether a replay's mods are ones the game can play with: known, no pair of opposites, none in challenge mode. */
export const validMods = (mods: number, challenge: number) =>
  Number.isInteger(mods) &&
  (mods & ~ALL) === 0 &&
  PAIRS.every((pair) => (mods & pair) !== pair) &&
  !(mods && challenge);

export const activeMods = (mods: number) => MODS.filter(([bit]) => mods & bit);

// the score's multiplier as a fraction of integers, so the game's integer total and this one never differ
function ratio(mods: number): [number, number] {
  let [num, den] = [1, 1];
  for (const [bit, , , percent] of MODS)
    if (mods & bit && percent !== 100) [num, den] = [num * percent, den * 100];
  return [num, den];
}

export function multiplierOf(mods: number) {
  const [num, den] = ratio(mods);
  return num / den;
}

/** The score a play counts for with its modifiers, rounded like the game does. The grade stays the score's. */
export function totalOf(score: number, mods: number) {
  const [num, den] = ratio(mods);
  const scaled = score * num + den / 2;
  return (scaled - (scaled % den)) / den;
}

const seconds = (...windows: number[]) => windows.map(Math.fround) as [number, number, number];
/** The perfect, good and bad windows in seconds: the game's own, and the ones Easy and Hard Rock set. */
export const WINDOWS = seconds(0.08, 0.18, 0.22);
const EASY = seconds(0.112, 0.252, 0.308);
const HARD = seconds(0.057, 0.129, 0.157);
export const windowsOf = (mods: number) => (mods & Mod.EZ ? EASY : mods & Mod.HR ? HARD : WINDOWS);

/** How fast the song and the game's clock run. */
export const rateOf = (mods: number) => (mods & Mod.HT ? 0.75 : mods & Mod.NC ? 1.25 : 1);

/** mulberry32: what gives the next 32 bits from a seed, like the game's. */
export function random(seed: number) {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return (t ^ (t >>> 14)) >>> 0;
  };
}

// Random's lanes: 5 of them 3 wide, centred on the positions charts put most notes at
const LANES = 5;
const LANE = 3;
const EDGE = (LANES * LANE) / 2;

/**
 * The chart a replay was played on: Random moves every note between -7.5 and 7.5 by whole lanes, shuffled from the
 * replay's seed. The game shuffles after mirroring the chart and the judge mirrors after this, hence the signs.
 */
export function modChart(raw: RawChart, mods: number, seed: number, mirror: boolean): RawChart {
  if (!(mods & Mod.RD)) return raw;
  const next = random(seed);
  const lanes = Array.from({ length: LANES }, (_, i) => i);
  for (let i = LANES - 1; i > 0; i--) {
    const j = next() % (i + 1);
    [lanes[i], lanes[j]] = [lanes[j]!, lanes[i]!];
  }
  const sign = mirror ? -1 : 1;
  const move = <T extends { positionX: number }>(notes: T[]) =>
    notes.map((note) => {
      const x = sign * Math.fround(note.positionX);
      if (x < -EDGE || x >= EDGE) return note;
      const lane = Math.floor((x + EDGE) / LANE);
      return { ...note, positionX: sign * Math.fround(x + (lanes[lane]! - lane) * LANE) };
    });
  return {
    ...raw,
    judgeLineList: raw.judgeLineList.map((line) => ({
      ...line,
      notesAbove: move(line.notesAbove),
      notesBelow: move(line.notesBelow),
    })),
  };
}

const clamp = (x: number) => Math.max(0, Math.min(1, x));

/**
 * How visible a note is `d` screen heights from its line (a hold: its head, 0 once held). Hidden fades it out as it
 * comes, Flashlight shows it only near the line, nearer as the combo grows.
 */
export function noteAlpha(mods: number, d: number, combo: number) {
  let alpha = 1;
  if (mods & Mod.HD) alpha *= clamp((d - 0.15) / 0.15);
  if (mods & Mod.FL) {
    const lit = combo >= 200 ? 0.75 : combo >= 100 ? 0.8125 : 1;
    alpha *= clamp((0.7 * lit - d) / (0.15 * lit));
  }
  return alpha;
}
