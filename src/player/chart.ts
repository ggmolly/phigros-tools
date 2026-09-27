/** 1 = tap, 2 = drag, 3 = hold, 4 = flick */
export type NoteType = 1 | 2 | 3 | 4;

/** a linear segment from value a (and a2, for moves' y) at s seconds to b (b2) at e seconds */
export type Segment = { s: number; e: number; a: number; b: number; a2: number; b2: number };
type SpeedSegment = { s: number; e: number; v: number; fp: number };

export type Note = {
  type: NoteType;
  sec: number;
  holdSec: number;
  x: number;
  speed: number;
  /** the line's floor position at the note's time (how far it scrolls before reaching the line) */
  fp: number;
  above: boolean;
  /** does it lands at the same instant as another note? */
  multi: boolean;
};

export type Line = {
  bpm: number;
  speed: SpeedSegment[];
  move: Segment[];
  rotate: Segment[];
  alpha: Segment[];
  notes: Note[];
};

export type Chart = {
  lines: Line[];
  duration: number;
  noteCount: number;
  /** seconds into the song where chart time 0 falls */
  offset: number;
  /** when each note is judged (a hold at its release), sorted: the combo at t is how many are <= t */
  judged: number[];
  /** every note's hit (a hold's at its start), sorted (for hit sounds) */
  hits: { sec: number; type: NoteType }[];
};

type RawSegment = {
  startTime: number;
  endTime: number;
  start: number;
  end: number;
  start2?: number;
  end2?: number;
};
type RawNote = {
  type: NoteType;
  time: number;
  positionX: number;
  holdTime: number;
  speed: number;
  floorPosition: number;
};
type RawLine = {
  bpm: number;
  notesAbove: RawNote[];
  notesBelow: RawNote[];
  speedEvents: { startTime: number; endTime: number; value: number }[];
  judgeLineMoveEvents: RawSegment[];
  judgeLineRotateEvents: RawSegment[];
  judgeLineDisappearEvents: RawSegment[];
};
export type RawChart = { formatVersion: number; offset: number; judgeLineList: RawLine[] };

export function parseChart(raw: RawChart): Chart {
  const { formatVersion } = raw;
  if (formatVersion !== 1 && formatVersion !== 3)
    throw new Error(`Unsupported chart format ${formatVersion}`);
  const lines = raw.judgeLineList.map((line): Line => {
    // chart times count 32nds of a beat at the line's BPM
    const sec = (time: number) => (time * 1.875) / line.bpm;
    const segments = (list: RawSegment[]) =>
      list.map((ev) => ({
        s: sec(ev.startTime),
        e: sec(ev.endTime),
        a: ev.start,
        b: ev.end,
        a2: ev.start2 ?? 0,
        b2: ev.end2 ?? 0,
      }));
    // format 1 packs a move's x and y into one number: x.880.1000 + y.520
    const unpack = (v: number) => [Math.floor(v / 1000) / 880, (v % 1000) / 520] as const;
    const moves = (list: RawSegment[]) =>
      formatVersion === 3
        ? segments(list)
        : segments(list).map((segment) => {
            const [a, a2] = unpack(segment.a);
            const [b, b2] = unpack(segment.b);
            return { ...segment, a, b, a2, b2 };
          });
    // speed events carry no floor position in these files: integrate the speed from t = 0
    let fp = 0;
    let prev: SpeedSegment | undefined;
    const speed = line.speedEvents.map((ev) => {
      const s = Math.max(0, sec(ev.startTime));
      if (prev) fp += (s - prev.s) * prev.v;
      prev = { s, e: sec(ev.endTime), v: ev.value, fp };
      return prev;
    });
    const notes = (list: RawNote[], above: boolean) =>
      list.map(
        (n): Note => ({
          type: n.type,
          sec: sec(n.time),
          holdSec: sec(n.holdTime),
          x: n.positionX,
          speed: n.speed,
          fp: n.floorPosition,
          above,
          multi: false,
        }),
      );
    return {
      bpm: line.bpm,
      speed,
      move: moves(line.judgeLineMoveEvents),
      rotate: segments(line.judgeLineRotateEvents),
      alpha: segments(line.judgeLineDisappearEvents),
      notes: [...notes(line.notesAbove, true), ...notes(line.notesBelow, false)],
    };
  });
  const all = lines.flatMap((line) => line.notes);
  const perMs = new Map<number, number>();
  const ms = (n: Note) => Math.round(n.sec * 1000);
  for (const n of all) perMs.set(ms(n), (perMs.get(ms(n)) ?? 0) + 1);
  for (const n of all) n.multi = perMs.get(ms(n))! > 1;
  const judged = all.map((n) => n.sec + n.holdSec).sort((a, b) => a - b);
  return {
    lines,
    duration: (judged.at(-1) ?? 0) + 1,
    noteCount: all.length,
    offset: raw.offset,
    judged,
    hits: all.map(({ sec, type }) => ({ sec, type })).sort((a, b) => a.sec - b.sec),
  };
}

/** returns the segment active at t: the first ending at or after it, else the last */
export function segmentAt<T extends { e: number }>(list: T[], t: number): T | undefined {
  let lo = 0;
  let hi = list.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid]!.e < t) lo = mid + 1;
    else hi = mid;
  }
  return list[lo];
}

/** returns segment's value at t (its second value with `second`), held flat outside its span */
export function valueAt(segment: Segment | undefined, t: number, second = false) {
  if (!segment) return 0;
  const { s, e } = segment;
  const k = e > s ? Math.min(1, Math.max(0, (t - s) / (e - s))) : 1;
  return second
    ? segment.a2 + (segment.b2 - segment.a2) * k
    : segment.a + (segment.b - segment.a) * k;
}

/** how far the line has scrolled by t, in floor units */
export function lineFloor(line: Line, t: number) {
  const segment = segmentAt(line.speed, t);
  return segment ? segment.fp + (t - segment.s) * segment.v : 0;
}

/** how many entries of `list` (sorted by `time`) fall at or before t */
export function countUpTo<T>(list: T[], t: number, time: (entry: T) => number) {
  let lo = 0;
  let hi = list.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (time(list[mid]!) <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}
