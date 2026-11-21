import type { RawBlockArea } from "./chart";

/*
 * Block areas (GameInformation.BlockArea, drawn by PreviewBlockControl): rectangles of the play area, placed in
 * "percentages" of it with y up, which block the touches that land in them while enabled. Times are seconds on the
 * notes' clock.
 */

type Vec = { x: number; y: number };
export type BlockPose = { x: number; y: number; w: number; h: number; rot: number };

const f = Math.fround;

// GetEase: 15 eases sampled at 101 points, read with linear interpolation. 0 linear, then quad, cubic, quart and
// quint as in / out / in-out, 13 holds the start and 14 jumps to the end
const EASES = (() => {
  const table = Array.from({ length: 15 }, (_, type) =>
    new Array<number>(101).fill(type === 14 ? 1 : 0).map((v, k) => (type === 0 ? f(k / 100) : v)),
  );
  for (const g of [1, 4, 7, 10]) {
    const p = Math.trunc(g / 3) + 2;
    for (let k = 0; k <= 100; k++) {
      table[g]![k] = f(f(k / 100) ** p);
      table[g + 1]![k] = f(1 - f(f(f(k / -100) + 1) ** p));
    }
    for (let k = 0; k < 100; k++)
      table[g + 2]![k] =
        k < 50 ? f(table[g]![2 * k]! * 0.5) : f(f(table[g + 1]![2 * (k - 50)]! * 0.5) + 0.5);
    table[g + 2]![100] = 1;
  }
  return table;
})();

function ease(type: number, progress: number) {
  const row = EASES[type]!;
  const x = progress * 100;
  const i = Math.trunc(x);
  if (i >= 100) return row[100]!;
  if (i < 0) return row[0]!;
  const v = row[i]! + (x - i) * (row[i + 1]! - row[i]!);
  return v < 0 ? 0 : Math.min(v, 1);
}

// the last event at or before t, -1 before the first
function current(events: { time: number }[], t: number) {
  let i = -1;
  while (i + 1 < events.length && events[i + 1]!.time <= t) i++;
  return i;
}

const safeDiv = (n: number, d: number) => (d === 0 ? 1 : n / d);

/** Mirror mode flips the areas left to right before anything else (BlockArea.Mirror). */
export function mirrorBlock(b: RawBlockArea): RawBlockArea {
  return {
    ...b,
    topRightPercentage: { ...b.topRightPercentage, x: 1 - b.bottomLeftPercentage.x },
    bottomLeftPercentage: { ...b.bottomLeftPercentage, x: 1 - b.topRightPercentage.x },
    rotateEvents: b.rotateEvents.map((e) => ({
      ...e,
      anchor: { ...e.anchor, x: 1 - e.anchor.x },
      rotation: -e.rotation,
    })),
    moveEvents: b.moveEvents.map((e) => ({
      ...e,
      endPosition: { ...e.endPosition, x: 1 - e.endPosition.x },
    })),
    scaleEvents: b.scaleEvents.map((e) => ({ ...e, anchor: { ...e.anchor, x: 1 - e.anchor.x } })),
  };
}

export const visible = (b: RawBlockArea, t: number) => b.appearTime <= t && t < b.disappearTime;
export const enabled = (b: RawBlockArea, t: number) => b.enableTime <= t && t < b.disableTime;

/**
 * Where the area is at t in a play area of W by H centered on the origin, y up: its center, its size and its turn in
 * degrees counterclockwise. Scale then rotation move the center around each event's anchor by the change since the
 * previous event only, while the size and the angle are absolute, then the moves set the center.
 */
export function blockPose(b: RawBlockArea, t: number, W: number, H: number): BlockPose {
  const world = (p: Vec) => ({ x: (p.x - 0.5) * W, y: (p.y - 0.5) * H });
  const tr = world(b.topRightPercentage);
  const bl = world(b.bottomLeftPercentage);
  const start = { x: (tr.x + bl.x) / 2, y: (tr.y + bl.y) / 2 };
  let size = { x: tr.x - bl.x, y: tr.y - bl.y };
  let c = start;
  const progress = (a: { time: number }, next: { time: number }, type: number) =>
    ease(type, (t - a.time) / (next.time - a.time));

  const se = b.scaleEvents;
  const si = current(se, t);
  if (si >= 0) {
    const around = (anchor: Vec, sx: number, sy: number) => {
      const a = world(anchor);
      c = { x: a.x + sx * (c.x - a.x), y: a.y + sy * (c.y - a.y) };
    };
    for (let j = 1; j <= si; j++)
      around(
        se[j - 1]!.anchor,
        safeDiv(se[j]!.scale.x, se[j - 1]!.scale.x),
        safeDiv(se[j]!.scale.y, se[j - 1]!.scale.y),
      );
    const cur = se[si]!;
    let s = cur.scale;
    const next = se[si + 1];
    if (next) {
      s = {
        x: cur.scale.x + progress(cur, next, cur.easeTypeX) * (next.scale.x - cur.scale.x),
        y: cur.scale.y + progress(cur, next, cur.easeTypeY) * (next.scale.y - cur.scale.y),
      };
      around(cur.anchor, safeDiv(s.x, cur.scale.x), safeDiv(s.y, cur.scale.y));
    }
    size = { x: size.x * s.x, y: size.y * s.y };
  }

  let rot = 0;
  const re = b.rotateEvents;
  const ri = current(re, t);
  if (ri >= 0) {
    const turn = (anchor: Vec, deg: number) => {
      if (deg === 0) return;
      const a = world(anchor);
      const r = deg * 0.017453292;
      const [cos, sin] = [Math.cos(r), Math.sin(r)];
      const [dx, dy] = [c.x - a.x, c.y - a.y];
      c = { x: a.x + dx * cos - dy * sin, y: a.y + dx * sin + dy * cos };
    };
    for (let j = 1; j <= ri; j++) turn(re[j - 1]!.anchor, re[j]!.rotation - re[j - 1]!.rotation);
    const cur = re[ri]!;
    rot = cur.rotation;
    const next = re[ri + 1];
    if (next) {
      rot = cur.rotation + progress(cur, next, cur.easeType) * (next.rotation - cur.rotation);
      turn(cur.anchor, rot - cur.rotation);
    }
  }

  let pos = c;
  const me = b.moveEvents;
  const mi = current(me, t);
  if (mi >= 0) {
    const cur = me[mi]!;
    let m = cur.endPosition;
    const next = me[mi + 1];
    if (next)
      m = {
        x: m.x + progress(cur, next, cur.easeTypeX) * (next.endPosition.x - m.x),
        y: m.y + progress(cur, next, cur.easeTypeY) * (next.endPosition.y - m.y),
      };
    const w = world(m);
    pos = { x: w.x + c.x - start.x, y: w.y + c.y - start.y };
  }
  return { x: pos.x, y: pos.y, w: Math.abs(size.x), h: Math.abs(size.y), rot };
}

/**
 * Whether a touch at (x, y), in the same space as blockPose, lands where an enabled area blocks it
 * (JudgeControl.TryGetBlockingBlock). Subtract areas cut holes in the others by parity, and the test is made twice:
 * on the areas as drawn, and with normal areas shrunk and subtract ones grown by `inset`. Both must block.
 */
export function blocking(
  areas: RawBlockArea[],
  t: number,
  x: number,
  y: number,
  W: number,
  H: number,
  inset: number,
) {
  let normal = false;
  let subtract = 0;
  let normalInset = false;
  let subtractInset = 0;
  for (const b of areas) {
    // a hidden area is parked far off the play area
    if (!enabled(b, t) || !visible(b, t)) continue;
    const p = blockPose(b, t, W, H);
    if (p.w < 1e-4 || p.h < 1e-4) continue;
    const r = (-p.rot * Math.PI) / 180;
    const [dx, dy] = [x - p.x, y - p.y];
    const lx = Math.abs((dx * Math.cos(r) - dy * Math.sin(r)) / p.w);
    const ly = Math.abs((dx * Math.sin(r) + dy * Math.cos(r)) / p.h);
    if (lx <= 0.5 && ly <= 0.5) {
      if (b.isSubtract) subtract++;
      else normal = true;
    }
    const sign = b.isSubtract ? 1 : -1;
    if (
      lx <= Math.max(0.5 + (sign * inset) / p.w, 0) &&
      ly <= Math.max(0.5 + (sign * inset) / p.h, 0)
    ) {
      if (b.isSubtract) subtractInset++;
      else normalInset = true;
    }
  }
  return normal !== (subtract % 2 === 1) && normalInset !== (subtractInset % 2 === 1);
}
