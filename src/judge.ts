import type { ReplayFrame, ReplayHeader } from "./pigeon";
import type { RawChart } from "./player/chart";

/**
 * Phigros' judgement, fed a replay's frames: which notes were hit how, the score and the max combo, as the game got
 * them. A port of the game's code (Phigros 4.0.1: FingerManagement, JudgeControl, the note controls and ScoreControl)
 * where every value is an f32 and every operation rounds once, like the game's single precision code. Charts with
 * blocks and special songs' effects aren't covered.
 */

const f = Math.fround;
const PI = f(Math.PI);
const C = f(16 / 9); // the aspect charts are laid out for, compared against
const C2 = 1.7777780294418335; // and divided by
// perfect, good and bad windows in seconds, normal play. challenge mode narrows them to these plus half the average
// of the last 10 delta times
export const WINDOWS = [0.07999999821186066, 0.18000000715255737, 0.2199999988079071];
export const CHALLENGE = [0.03999999910593033, 0.09000000357627869, 0.14000000059604645];
const NEAR = 0.009999999776482582; // notes this close in time compete by distance
const TAP_REACH = 1.899999976158142; // world units along the line
const REACH = 2.0999999046325684; // for drags and flicks
const HOLD_REACH = 1.899999976158142;
const DRAG_WINDOW = 0.10000000149011612;
const LAND = 0.004999999888241291; // drags and flicks are scored this close to the line
const BEGAN = 0;

export type Judgement = "perfect" | "good" | "bad" | "miss";

/** A note as the game keeps it (ChartNote), with where it came from in the chart. */
interface Note {
  type: number;
  realTime: number;
  holdTime: number;
  positionX: number;
  floorPosition: number;
  line: number;
  isJudged: boolean;
  isJudgedForFlick: boolean;
  /** the index of the note in its line's chart list (above, then below), for the viewer */
  source: { line: number; below: boolean; index: number };
}

interface Segment {
  startTime: number;
  endTime: number;
  start: number;
  end: number;
  start2: number;
  end2: number;
}

interface Line {
  bpm: number;
  move: Segment[];
  rotate: Segment[];
  moveIndex: number;
  rotateIndex: number;
  /** the line's state from the last update, which this frame's fingers are measured against */
  x: number;
  y: number;
  theta: number;
  fingerX: number[];
  fingerY: number[];
}

interface Finger {
  id: number;
  lastMove: [number, number];
  nowMove: [number, number];
  positions: [number, number][]; // the last three, newest first
  phase: number;
  isNewFlick: boolean;
  stopped: boolean;
}

export interface Hit {
  /** the note in the chart: its line, list and index there */
  line: number;
  below: boolean;
  index: number;
  judgement: Judgement;
  /** when it was judged, the frame's song time */
  t: number;
  /** when it was hit (a hold: its head), even for a hold dropped later and missed */
  hit?: number;
  /** seconds late (negative early), for perfects, goods and bads */
  offset?: number;
}

export interface Result {
  hits: Hit[];
  /** the combo and score after each frame that changed them: [song time, combo, score], for the viewer */
  timeline: [number, number, number][];
  score: number;
  maxcombo: number;
  perfect: number;
  good: number;
  bad: number;
  miss: number;
  early: number;
  late: number;
}

// .NET's unstable introsort (ArraySortHelper), since notes that tie are judged in the order it leaves them
function introsort<T>(a: T[], cmp: (x: T, y: T) => number) {
  const swap = (i: number, j: number) => {
    const t = a[i]!;
    a[i] = a[j]!;
    a[j] = t;
  };
  const swapIfGreater = (i: number, j: number) => {
    if (i !== j && cmp(a[i]!, a[j]!) > 0) swap(i, j);
  };
  const insertion = (lo: number, hi: number) => {
    for (let i = lo; i < hi; i++) {
      const t = a[i + 1]!;
      let j = i;
      while (j >= lo && cmp(t, a[j]!) < 0) {
        a[j + 1] = a[j]!;
        j--;
      }
      a[j + 1] = t;
    }
  };
  const downHeap = (start: number, n: number, lo: number) => {
    let i = start;
    const d = a[lo + i - 1]!;
    while (i <= Math.trunc(n / 2)) {
      let c = 2 * i;
      if (c < n && cmp(a[lo + c - 1]!, a[lo + c]!) < 0) c++;
      if (!(cmp(d, a[lo + c - 1]!) < 0)) break;
      a[lo + i - 1] = a[lo + c - 1]!;
      i = c;
    }
    a[lo + i - 1] = d;
  };
  const heapsort = (lo: number, hi: number) => {
    const n = hi - lo + 1;
    for (let i = Math.trunc(n / 2); i >= 1; i--) downHeap(i, n, lo);
    for (let i = n; i >= 2; i--) {
      swap(lo, lo + i - 1);
      downHeap(1, i - 1, lo);
    }
  };
  const partition = (lo: number, hi: number) => {
    const mid = lo + Math.trunc((hi - lo) / 2);
    swapIfGreater(lo, mid);
    swapIfGreater(lo, hi);
    swapIfGreater(mid, hi);
    const pivot = a[mid]!;
    swap(mid, hi - 1);
    let left = lo;
    let right = hi - 1;
    while (left < right) {
      do left++;
      while (cmp(a[left]!, pivot) < 0);
      do right--;
      while (cmp(pivot, a[right]!) < 0);
      if (left >= right) break;
      swap(left, right);
    }
    if (left !== hi - 1) swap(left, hi - 1);
    return left;
  };
  const sort = (lo: number, start: number, depth: number) => {
    let hi = start;
    while (hi > lo) {
      const size = hi - lo + 1;
      if (size <= 16) {
        if (size === 2) swapIfGreater(lo, hi);
        else if (size === 3) {
          swapIfGreater(lo, hi - 1);
          swapIfGreater(lo, hi);
          swapIfGreater(hi - 1, hi);
        } else insertion(lo, hi);
        return;
      }
      if (depth === 0) return heapsort(lo, hi);
      depth--;
      const p = partition(lo, hi);
      sort(p + 1, hi, depth);
      hi = p - 1;
    }
  };
  let log = 0;
  for (let n = a.length; n >= 1; n >>= 1) log++;
  if (a.length > 1) sort(0, a.length - 1, 2 * log);
}

// float.CompareTo, which puts NaN first
const compare = (x: number, y: number) =>
  x < y ? -1 : x > y ? 1 : x === y ? 0 : Number.isNaN(x) ? (Number.isNaN(y) ? 0 : -1) : 1;

/** the line's value at now from its current segment, extrapolated past its ends like the game */
const lerp = (e: Segment, now: number, from: number, to: number) =>
  f(f(f(f(to - from) * f(now - e.startTime)) / f(e.endTime - e.startTime)) + from);

// the first event ending after now, moved from where it was last frame (UpdateJudgeLineEventIndex)
function eventIndex(list: Segment[], index: number, now: number) {
  let i = index;
  while (i < list.length - 1 && !(list[i]!.endTime > now)) i++;
  while (i > 0 && list[i - 1]!.endTime > now) i--;
  return i;
}

/** Judges a replay's frames on the chart, like the game did when it was played. */
export function judge(raw: RawChart, frames: ReplayFrame[], screen: ReplayHeader): Result {
  let [P, G, B] = WINDOWS as [number, number, number];
  const lastDeltas: number[] = [];
  const aspect = f(screen.width / screen.height);
  const mirror = screen.mirror === 1;
  const narrow = aspect <= C;
  const lines: Line[] = [];
  const byTime: Note[] = [];
  const created: Note[][] = [[], [], [], []]; // taps, drags, holds, flicks, in the order the game makes them

  raw.judgeLineList.forEach((rawLine, i) => {
    const bpm = f(rawLine.bpm);
    const toSec = (x: number) => f(f(f(Math.trunc(x)) * 1.875) / bpm);
    const notes = (list: typeof rawLine.notesAbove, below: boolean) => {
      const sorted = list.map((note, index) => ({ note, index }));
      introsort(sorted, (a, b) => compare(f(a.note.floorPosition), f(b.note.floorPosition)));
      return sorted.map(({ note, index }): Note => {
        let positionX = mirror ? -f(note.positionX) : f(note.positionX);
        if (aspect < C) positionX = f(f(aspect / C2) * positionX);
        return {
          type: note.type,
          realTime: f(f(f(note.time) * 1.875) / bpm),
          holdTime: f(f(f(Math.trunc(f(f(note.holdTime) + 9.999999747378752e-5))) * 1.875) / bpm),
          positionX,
          floorPosition: f(note.floorPosition),
          line: i,
          isJudged: false,
          isJudgedForFlick: false,
          source: { line: i, below, index },
        };
      });
    };
    const above = notes(rawLine.notesAbove, false);
    const below = notes(rawLine.notesBelow, true);
    byTime.push(...above, ...below);
    for (const note of [...above, ...below])
      if (note.type >= 1 && note.type <= 4) created[note.type - 1]!.push(note);

    const x = (v: number) =>
      narrow
        ? f(f(screen.width) * f(f(f(f(v) - 0.5) * 10) / f(screen.height)))
        : f(f(f(f(f(v) - 0.5) * 10) / 9) * 16);
    const packedX = (q: number) =>
      narrow
        ? f(f(screen.width) * f(f(f(f(f(q - 440) / 440) * 5)) / f(screen.height)))
        : f(f(f(f(f(f(q - 440) / 440) * 5) / 9) * 16));
    // mirror mode flips the chart before anything else (Chart.Mirror)
    const flip = (v: number) =>
      !mirror
        ? f(v)
        : raw.formatVersion === 1
          ? f(f(880000 - f(v)) + f(f(f(v) % 1000) * 2))
          : f(1 - f(v));
    const move = rawLine.judgeLineMoveEvents.map((e): Segment => {
      const times = { startTime: toSec(e.startTime), endTime: toSec(e.endTime) };
      if (raw.formatVersion === 3)
        return {
          ...times,
          start: x(flip(e.start)),
          end: x(flip(e.end)),
          start2: f(f(f(e.start2 ?? 0) - 0.5) * 10),
          end2: f(f(f(e.end2 ?? 0) - 0.5) * 10),
        };
      // format 1 packs x * 1000 + y
      const unpack = (value: number) => {
        const v = Math.trunc(f(value));
        return [packedX(Math.trunc(v / 1000)), f(f((v % 1000) - 260) / 52)] as const;
      };
      const [start, start2] = unpack(flip(e.start));
      const [end, end2] = unpack(flip(e.end));
      return { ...times, start, end, start2, end2 };
    });
    const rotate = rawLine.judgeLineRotateEvents.map(
      (e): Segment => ({
        startTime: toSec(e.startTime),
        endTime: toSec(e.endTime),
        start: mirror ? -f(e.start) : f(e.start),
        end: mirror ? -f(e.end) : f(e.end),
        start2: 0,
        end2: 0,
      }),
    );
    lines.push({
      bpm,
      move,
      rotate,
      moveIndex: 0,
      rotateIndex: 0,
      x: 0,
      y: 0,
      theta: 0,
      fingerX: [],
      fingerY: [],
    });
  });
  introsort(byTime, (a, b) => compare(a.realTime, b.realTime));

  const flickSpeed = f(f(0.05999999865889549 / 380) * f(screen.dpi));
  const toWorld = (px: number, py: number): [number, number] => [
    f(f(f(f(px / screen.width) * 2) - 1) * f(5 * aspect)),
    f(f(f(f(py / screen.height) * 2) - 1) * 5),
  ];
  let fingers: Finger[] = [];
  const length = (v: [number, number]) => f(Math.sqrt(f(f(v[0] * v[0]) + f(v[1] * v[1]))));

  const result: Result = {
    hits: [],
    timeline: [],
    score: 0,
    maxcombo: 0,
    perfect: 0,
    good: 0,
    bad: 0,
    miss: 0,
    early: 0,
    late: 0,
  };
  let combo = 0;
  let now = 0;
  const total = f(byTime.length);
  // ScoreControl.Update and the result's rounding. challenge mode leaves the combo out
  const currentScore = () => {
    const accuracy = f(f(f(f(result.good) * 0.6499999761581421) + f(result.perfect)) / total);
    const raw =
      screen.challenge === 1
        ? f(accuracy * 1000000)
        : f(f(accuracy * 900000) + f(f(f(result.maxcombo) * 100000) / total));
    return Math.trunc(f(Math.min(1000000, Math.max(0, raw)) + 0.5));
  };
  const score = (note: Note, judgement: Judgement, late?: number, hit?: number) => {
    result.hits.push({ ...note.source, judgement, t: now, offset: late, hit });
    result[judgement]++;
    if (judgement === "bad" || judgement === "miss") combo = 0;
    else combo++;
    if (judgement === "good") {
      if (late! > 0) result.late++;
      else result.early++;
    }
  };

  // per note control state, by note
  // a hold also keeps when its head was hit
  const control = new Map<
    Note,
    {
      isJudged: boolean;
      judged?: boolean;
      missed?: boolean;
      over?: boolean;
      perfect?: boolean;
      safe: number;
      at: number;
      head: number;
    }
  >();
  for (const list of created)
    for (const note of list) control.set(note, { isJudged: false, safe: 0, at: 0, head: 0 });
  const queue = created.map((list) => [...list]);

  for (const [index, frame] of frames.entries()) {
    now = frame.t;
    const dt = frame.dt;
    // a ring of the last 10, summed in its slot order like ProgressControl.Update
    if (screen.challenge === 1) {
      lastDeltas[index % 10] = dt;
      let sum = 0;
      for (const delta of lastDeltas) sum = f(sum + delta);
      const half = f(f(sum / lastDeltas.length) * 0.5);
      [P, G, B] = CHALLENGE.map((window) => f(half + window)) as [number, number, number];
    }

    // FingerManagement: follow the touches, then tell new flicks
    const ids = new Set(frame.touches.map((touch) => touch.id));
    for (const touch of frame.touches)
      if (!fingers.some((finger) => finger.id === touch.id)) {
        const p = toWorld(touch.x, touch.y);
        fingers.push({
          id: touch.id,
          lastMove: [0, 0],
          nowMove: [0, 0],
          positions: [p, p, p],
          phase: 0,
          isNewFlick: false,
          stopped: true,
        });
      }
    fingers = fingers.filter((finger) => ids.has(finger.id));
    for (const finger of fingers) {
      const touch = frame.touches.find((t) => t.id === finger.id)!;
      const p = toWorld(touch.x, touch.y);
      finger.positions = [p, finger.positions[0]!, finger.positions[1]!];
      finger.lastMove = finger.nowMove;
      finger.nowMove = [f(p[0] - finger.positions[2]![0]), f(p[1] - finger.positions[2]![1])];
      finger.phase = touch.phase;
    }
    for (const finger of fingers) {
      const lastLength = length(finger.lastMove);
      let speed = 0;
      if (lastLength > 0.10000000149011612)
        speed = f(
          f(f(finger.lastMove[0] * finger.nowMove[0]) + f(finger.lastMove[1] * finger.nowMove[1])) /
            lastLength,
        );
      const v = f(f(speed / 60) / dt);
      if (!(v >= flickSpeed) || finger.stopped) {
        const s = f(f(length(finger.nowMove) / 60) / dt);
        const threshold = f(flickSpeed * 5);
        finger.isNewFlick = s >= threshold;
        finger.stopped = !(s >= threshold);
      }
    }

    // JudgeControl: fingers measured against the lines as they were last frame, then taps and flicks
    if (now >= 0) {
      for (const line of lines) {
        const a1 = f(f(line.theta / -180) * PI);
        const a2 = f(f(line.theta / 180) * PI);
        const sin1 = f(Math.sin(a1));
        const cos1 = f(Math.cos(a1));
        const sin2 = f(Math.sin(a2));
        line.fingerX = fingers.map((finger) => {
          const [fx, fy] = finger.positions[0]!;
          return f(f(f(line.y - fy) * sin1) - f(f(line.x - fx) * cos1));
        });
        line.fingerY = fingers.map((finger) => {
          const [fx, fy] = finger.positions[0]!;
          return f(f(f(line.x - fx) * sin2) - f(cos1 * f(line.y - fy)));
        });
      }
      const distance = (note: Note, k: number) => {
        const line = lines[note.line]!;
        return f(
          Math.abs(f(note.positionX - line.fingerX[k]!)) +
            Math.abs(f(line.fingerY[k]! / 2.200000047683716)),
        );
      };
      const window = (ahead: number, behind: number) => {
        let end = -1;
        while (end < byTime.length - 1 && byTime[end + 1]!.realTime < f(now + ahead)) end++;
        let start = end;
        while (start >= 1 && byTime[start - 1]!.realTime > f(now + behind)) start--;
        return [start, end] as const;
      };
      fingers.forEach((finger, k) => {
        if (finger.phase === BEGAN) {
          const [start, end] = window(B, -G);
          let min = 10000;
          let code = -1;
          if (start >= 0 && start <= end) {
            for (let i = start; i <= end; i++) {
              const n = byTime[i]!;
              const along = Math.abs(f(n.positionX - lines[n.line]!.fingerX[k]!));
              if (n.isJudged) continue;
              if (!(f(n.realTime - now) < f(min + NEAR))) continue;
              if (!(along < TAP_REACH)) continue;
              let badTime = B;
              if (along > 0.8999999761581421)
                badTime = f(B + f(f(f(along + -0.8999999761581421) * P) * -0.5));
              if (f(n.realTime - now) > badTime) continue;
              let take = code < 0;
              if (!take) {
                const c = byTime[code]!;
                if (c.type === 2 || c.type === 4) take = true;
                else if (
                  (n.type === 1 || n.type === 3) &&
                  !(Math.abs(f(c.realTime - n.realTime)) > NEAR)
                )
                  take = distance(n, k) < distance(c, k);
              }
              if (take) {
                code = i;
                min = Math.abs(f(n.realTime - now));
              }
            }
            if (code >= 0 && byTime[code]!.type !== 4) byTime[code]!.isJudged = true;
          }
        }
        if (finger.isNewFlick) {
          const W = f(P * 1.75);
          const [start, end] = window(W, f(P * -1.75));
          let min = 10000;
          let code = -1;
          if (start >= 0 && start <= end) {
            for (let i = start; i <= end; i++) {
              const n = byTime[i]!;
              if (n.type !== 4 || n.isJudgedForFlick) continue;
              if (!(f(n.realTime - now) < f(min + NEAR))) continue;
              if (!(Math.abs(f(n.positionX - lines[n.line]!.fingerX[k]!)) < REACH)) continue;
              let take = code < 0;
              if (!take) {
                if (Math.abs(f(byTime[code]!.realTime - n.realTime)) > NEAR) continue;
                take = distance(n, k) < distance(byTime[code]!, k);
              }
              if (take) {
                code = i;
                min = Math.abs(f(n.realTime - now));
              }
            }
            if (code >= 0) {
              byTime[code]!.isJudgedForFlick = true;
              finger.isNewFlick = false;
            }
          }
        }
      });
    }

    // NoteUpdateManager: the lines move to now, then every note close enough judges itself
    for (const line of lines) {
      line.moveIndex = eventIndex(line.move, line.moveIndex, now);
      line.rotateIndex = eventIndex(line.rotate, line.rotateIndex, now);
      if (!(now >= 0)) {
        line.x = 0;
        line.y = 0;
      } else {
        const e = line.move[line.moveIndex];
        if (e) {
          line.x = lerp(e, now, e.start, e.end);
          line.y = lerp(e, now, e.start2, e.end2);
        }
        const r = line.rotate[line.rotateIndex];
        if (r) line.theta = lerp(r, now, r.start, r.end);
      }
    }
    const fingersNear = (note: Note, reach: number) =>
      lines[note.line]!.fingerX.some((x) => Math.abs(f(x - note.positionX)) < reach);
    const judgeNote = (note: Note): boolean => {
      const c = control.get(note)!;
      const d = f(note.realTime - now);
      switch (note.type) {
        case 1: {
          c.isJudged ||= note.isJudged;
          if (c.isJudged) {
            score(note, Math.abs(d) < P ? "perfect" : Math.abs(d) < G ? "good" : "bad", -d, now);
            return true;
          }
          if (d < -G) {
            score(note, "miss");
            note.isJudged = true;
            return true;
          }
          return false;
        }
        case 2: {
          if (!(Math.abs(d) > DRAG_WINDOW) && !c.isJudged && fingersNear(note, REACH))
            c.isJudged = true;
          if (d < LAND && c.isJudged) {
            score(note, "perfect", -d, now);
            note.isJudged = true;
            return true;
          }
          if (d < -DRAG_WINDOW && !c.isJudged) {
            score(note, "miss");
            note.isJudged = true;
            return true;
          }
          return false;
        }
        case 4: {
          c.isJudged ||= note.isJudgedForFlick;
          if (d < LAND && c.isJudged) {
            score(note, "perfect", -d, now);
            note.isJudged = true;
            return true;
          }
          if (d < f(P * -1.75)) {
            score(note, "miss");
            note.isJudged = true;
            note.isJudgedForFlick = true;
            return true;
          }
          return false;
        }
        default: {
          // a hold: graded at its head, held with at most 3 frames without a finger, scored near its end
          if (!c.judged && !c.missed) {
            c.isJudged ||= note.isJudged;
            if (c.isJudged) {
              if (Math.abs(d) < P)
                Object.assign(c, { judged: true, perfect: true, at: d, head: now });
              else if (Math.abs(d) < G)
                Object.assign(c, { judged: true, perfect: false, at: d, head: now });
              else note.isJudged = false;
            } else if (d < -G) {
              note.isJudged = true;
              c.missed = true;
              score(note, "miss");
            }
          }
          if (c.judged && !c.missed && !c.over) {
            if (fingersNear(note, HOLD_REACH)) c.safe = 2;
            else if (c.safe >= 0) c.safe--;
            else {
              c.over = true;
              c.missed = true;
              score(note, "miss", undefined, c.head);
            }
          }
          const end = f(note.realTime + note.holdTime);
          if (now > f(end + -0.2199999988079071) && c.judged && !c.over) {
            score(note, c.perfect ? "perfect" : "good", -c.at, c.head);
            c.over = true;
          }
          if (now > f(end + 0.25)) {
            if (!c.judged && !c.missed && !c.over) score(note, "miss");
            return true;
          }
          return false;
        }
      }
    };
    for (const list of queue)
      for (let i = 0; i < list.length; i++)
        if (!(list[i]!.realTime > f(now + 2)) && judgeNote(list[i]!)) list.splice(i--, 1);

    // ScoreControl: the max combo is sampled once a frame
    if (combo > result.maxcombo) result.maxcombo = combo;
    const last = result.timeline.at(-1);
    const scored = currentScore();
    if (last?.[1] !== combo || last[2] !== scored) result.timeline.push([now, combo, scored]);
  }
  result.score = currentScore();
  return result;
}
