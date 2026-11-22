import { CHALLENGE, type Result } from "./judge";
import { windowsOf } from "./modifiers";
import type { ReplayFrame, ReplayHeader } from "./pigeon";
import { type Chart, countUpTo, type RawChart } from "./player/chart";
import type { Play } from "./player/render";

/** What the chart player draws of a replay, judged or followed live: the fingers, and the play on the chart's notes. */

// the fingers look like the game's taps mod (mod/mods/taps.lua): a diamond on the recorded screen with a dark outline,
// yellow on the frame it lands, and a lifted finger fading out where it ended
const TAP = 110;
const OUTLINE = 14;
const FADE = 0.35; // seconds of song time
const TRAIL = 0.2; // how long a finger's path stays behind it
const LANDED = "255 217 77";
const HELD = "255 255 255";

/** The index of the last frame at or before song time t (-1 before the first), by halving: frames are in song order. */
function frameIndex(frames: ReplayFrame[], t: number) {
  if (!frames.length || frames[0]!.t > t) return -1;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle]!.t <= t) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The fingers at song time t and the ones lifted just before, mapped from the recorded screen (bottom left origin). */
export function drawFingers(header: ReplayHeader, frames: ReplayFrame[]) {
  return (ctx: CanvasRenderingContext2D, t: number, W: number, H: number) => {
    const scale = H / header.height;
    const screenX = (x: number) => (x / header.width) * W;
    const screenY = (y: number) => (1 - y / header.height) * H;
    const diamond = (x: number, y: number, rgb: string, alpha: number) => {
      ctx.save();
      ctx.translate(screenX(x), screenY(y));
      ctx.rotate(Math.PI / 4);
      const outer = ((TAP + OUTLINE) / 2) * scale;
      const inner = (TAP / 2) * scale;
      ctx.fillStyle = `rgb(0 0 0 / ${0.55 * alpha})`;
      ctx.fillRect(-outer, -outer, outer * 2, outer * 2);
      ctx.fillStyle = `rgb(${rgb} / ${0.9 * alpha})`;
      ctx.fillRect(-inner, -inner, inner * 2, inner * 2);
      ctx.restore();
    };
    const index = frameIndex(frames, t);
    if (index < 0) return;
    // the path of held fingers over the last TRAIL seconds, one segment per frame, thinner and fainter with age
    let start = index;
    while (start > 0 && frames[start - 1]!.t > t - TRAIL) start--;
    const last = new Map<number, { x: number; y: number }>();
    ctx.lineCap = "round";
    ctx.strokeStyle = "#fff";
    for (let i = Math.max(0, start - 1); i <= index; i++) {
      const fade = 1 - (t - frames[i]!.t) / TRAIL;
      for (const { id, phase, x, y } of frames[i]!.touches) {
        const from = phase === 0 ? undefined : last.get(id);
        if (from && fade > 0) {
          ctx.globalAlpha = 0.5 * fade;
          ctx.lineWidth = TAP * 0.5 * scale * fade;
          ctx.beginPath();
          ctx.moveTo(screenX(from.x), screenY(from.y));
          ctx.lineTo(screenX(x), screenY(y));
          ctx.stroke();
        }
        if (phase === 3 || phase === 4) last.delete(id);
        else last.set(id, { x, y });
      }
    }
    ctx.globalAlpha = 1;
    // lifted fingers of the last FADE seconds, oldest first so newer ones draw on top
    let from = index;
    while (from > 0 && frames[from - 1]!.t > t - FADE) from--;
    for (let i = from; i <= index; i++)
      for (const touch of frames[i]!.touches)
        if (touch.phase === 3 || touch.phase === 4)
          diamond(touch.x, touch.y, HELD, 1 - (t - frames[i]!.t) / FADE);
    const frame = frames[index]!;
    if (t - frame.t > 0.1) return;
    for (const touch of frame.touches)
      if (touch.phase !== 3 && touch.phase !== 4)
        diamond(touch.x, touch.y, touch.phase === 0 ? LANDED : HELD, 1);
  };
}

/** The judged play laid on the parsed chart's notes: a line's notes are its notes above, then below. */
export function toPlay(
  raw: RawChart,
  chart: Chart,
  result: Result,
  { challenge, mods }: ReplayHeader,
): Play & { hits: Chart["hits"] } {
  const judged: Play["judged"] = new Map();
  const hits: Chart["hits"] = [];
  for (const hit of result.hits) {
    const line = chart.lines[hit.line]!;
    const note =
      line.notes[(hit.below ? raw.judgeLineList[hit.line]!.notesAbove.length : 0) + hit.index]!;
    judged.set(note, { judgement: hit.judgement, hit: hit.hit, end: hit.t });
    if (hit.hit !== undefined && hit.judgement !== "bad" && hit.judgement !== "miss")
      hits.push({ sec: hit.hit, type: note.type });
  }
  hits.sort((a, b) => a.sec - b.sec);
  // the judgements in the order they came, each with the counts and the max combo up to it
  const KINDS = ["perfect", "good", "bad", "miss"] as const;
  const byTime = [...result.hits].sort((a, b) => a.t - b.t);
  const counts: [number, number, number, number][] = [];
  for (const hit of byTime) {
    const next = [...(counts.at(-1) ?? [0, 0, 0, 0])] as [number, number, number, number];
    next[KINDS.indexOf(hit.judgement)]!++;
    counts.push(next);
  }
  const maxcombo: number[] = [];
  for (const [, combo] of result.timeline) maxcombo.push(Math.max(maxcombo.at(-1) ?? 0, combo));
  const state = (t: number) => {
    const step = countUpTo(result.timeline, t, ([time]) => time) - 1;
    const entry = result.timeline[step];
    return {
      combo: entry?.[1] ?? 0,
      score: entry?.[2] ?? 0,
      maxcombo: maxcombo[step] ?? 0,
      counts: counts[countUpTo(byTime, t, (hit) => hit.t) - 1] ?? [0, 0, 0, 0],
    };
  };
  // drags and flicks are judged on time, they have no timing to show
  const timing: Play["timing"] = [];
  let average = 0;
  for (const hit of [...result.hits].sort((a, b) => (a.hit ?? a.t) - (b.hit ?? b.t))) {
    if (hit.offset === undefined || hit.judgement === "miss") continue;
    average = average * 0.9 + hit.offset * 1000 * 0.1;
    timing.push({ at: hit.hit ?? hit.t, ms: hit.offset * 1000, judgement: hit.judgement, average });
  }
  const windows = (challenge ? CHALLENGE : windowsOf(mods)).map(
    (window) => window * 1000,
  ) as Play["windows"];
  return { judged, state, hits, timing, windows, mods };
}
