import type { NoteType, RawChart } from "./chart";

// Decoder for .phc charts, the lossless chart codec in ../chart-codec (codec.py, whose README describes the format).
// A port of its decoding path: every step and every float64 operation mirrors codec.py in the same order, so the
// decoded f32 values match the raw chart JSON exactly (scripts/verify-chart-data.ts checks all of them).

// ---------------------------------------------------------------- probability layout (codec.py's channels)
const CTX_SIZE = 65; // 6-bit magnitude tree (nodes 1..63) + sign
const MANT_SIZE = 64 * 4;
const CAP = 24;
const K = 4; // timed-list kinds: speed, move, rotate, alpha
const FLAG_K = 12;
const POS_CACHE = 32;

type Channel = [base: number, mant: number];
let size = 0;
const chan = (nctx: number): Channel => {
  const base = size;
  size += nctx * CTX_SIZE + MANT_SIZE;
  return [base, base + nctx * CTX_SIZE];
};
const range = <T>(n: number, f: (i: number) => T) => Array.from({ length: n }, (_, i) => f(i));
const STRUCT = chan(1);
const RAW = chan(1);
const TJUMP = range(K, () => chan(1));
const DUR = range(K, () => chan(CAP));
const TRAW = range(K, () => chan(1));
const VJUMP = range(K, () => range(2, () => chan(CAP)));
const VAL = range(K, () => range(2, () => chan(4 * CAP * 2)));
const N_TYPE = chan(5);
const N_TIME = chan(CAP);
const N_POS = chan(CAP);
const N_HOLDI = chan(CAP);
const N_HOLDR = chan(1);
const N_SPEED = chan(2);
const N_FP = chan(CAP);
const S_FP = chan(1);
const FLAGS = size;
const NOTE_FLAGS = FLAGS + K * FLAG_K; // +0/1 integral hold time, +2/3 position cache hit, +8..39 cache index tree
const N_PROBS = FLAGS + K * FLAG_K + 40;

// ---------------------------------------------------------------- f32 helpers
const F32 = new Float32Array(1);
const U32 = new Uint32Array(F32.buffer);
function bitsToF64(bits: number) {
  U32[0] = bits;
  return F32[0]!;
}
/** Rounds to f32 (nearest even) and returns the bit pattern; non-finite or overflowing values give 0. */
function f64ToBits(x: number) {
  if (!Number.isFinite(x)) return 0;
  F32[0] = x;
  const bits = U32[0]!;
  return (bits & 0x7f800000) === 0x7f800000 ? 0 : bits;
}
/** f32 bits -> integer ordered like the float (distinct for -0 and 0). */
const ordf = (bits: number) => (bits < 0x80000000 ? bits : -1 - (bits - 0x80000000));
const unordf = (o: number) => (o >= 0 ? o : -1 - o + 0x80000000);
function bucket(r: number) {
  let x = Math.abs(r);
  let n = 0;
  while (x > 0) {
    n++;
    x = Math.floor(x / 2);
  }
  return n;
}

// ---------------------------------------------------------------- range decoder (LZMA-style, 16-bit adaptive probabilities)
const PROB_ONE = 65536;
const PROB_MIN = 32;
const RATE_LIMIT = 30;
const TOP = 1 << 24;

class Decoder {
  private pos = 0;
  private range = 0xffffffff;
  private code = 0;
  /** Probabilities of a 0 bit, then how many times each has been updated. */
  private probs = new Int32Array(2 * N_PROBS).fill(PROB_ONE / 2, 0, N_PROBS);

  constructor(private buf: Uint8Array) {
    for (let i = 0; i < 5; i++) this.code = ((this.code << 8) | this.byte()) >>> 0;
  }

  private byte() {
    return this.buf[this.pos++] ?? 0;
  }

  private normalize() {
    while (this.range < TOP) {
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.byte()) >>> 0;
    }
  }

  bit(i: number) {
    const probs = this.probs;
    let p = probs[i]!;
    const bound = (this.range >>> 16) * p;
    let bit: number;
    if (this.code < bound) {
      this.range = bound;
      bit = 0;
    } else {
      this.code -= bound;
      this.range -= bound;
      bit = 1;
    }
    this.normalize();
    const n = probs[N_PROBS + i]!;
    const d = bit === 0 ? PROB_ONE - p : -p;
    const step = Math.floor(Math.abs(d) / (n + 2));
    p = d >= 0 ? p + step : p - step;
    probs[i] = Math.min(Math.max(p, PROB_MIN), PROB_ONE - PROB_MIN);
    if (n < RATE_LIMIT) probs[N_PROBS + i] = n + 1;
    return bit;
  }

  direct(nbits: number) {
    let out = 0;
    for (let k = 0; k < nbits; k++) {
      this.range = this.range >>> 1;
      let bit = 0;
      if (this.code >= this.range) {
        this.code -= this.range;
        bit = 1;
      }
      out = out * 2 + bit;
      this.normalize();
    }
    return out;
  }

  /** A signed residual: magnitude bucket (6-bit tree), sign, 2 adaptive mantissa bits, then raw bits. */
  res([base, mant]: Channel, ctx: number) {
    const c = base + ctx * CTX_SIZE;
    let node = 1;
    for (let k = 0; k < 6; k++) node = node * 2 + this.bit(c + node);
    const b = node - 64;
    if (b === 0) return 0;
    const neg = this.bit(c + 64);
    const rest = b - 1;
    const top = rest >= 2 ? 2 : rest;
    const low = rest - top;
    let hi = 0;
    let mnode = 1;
    for (let k = 0; k < top; k++) {
      const bit = this.bit(mant + b * 4 + mnode);
      mnode = mnode * 2 + bit;
      hi = hi * 2 + bit;
    }
    const lo = low > 0 ? this.direct(low) : 0;
    const v = 2 ** rest + hi * 2 ** low + lo;
    return neg ? -v : v;
  }

  int() {
    return this.res(STRUCT, 0);
  }

  f32bits() {
    return unordf(this.res(RAW, 0));
  }
}

// ---------------------------------------------------------------- timed lists (speed + judge line events)
/** Lagrange extrapolation at t through the last order+1 knots, in float64 (codec.py's _predict). */
function predict(ht: Float64Array, hv: Float64Array, hn: number, t: number, order: number) {
  const n = order + 1;
  let s = 0;
  for (let j = hn - n; j < hn; j++) {
    let w = hv[j]!;
    for (let m = hn - n; m < hn; m++) {
      if (m === j) continue;
      if (ht[j] === ht[m]) return hv[hn - 1]!;
      w = w * ((t - ht[m]!) / (ht[j]! - ht[m]!));
    }
    s = s + w;
  }
  return s;
}

type Timed = {
  start: number;
  end: number;
  a: number;
  b: number;
  a2: number;
  b2: number;
  shape: number;
};

function decodeTimed(dec: Decoder, kind: number, n: number): Timed[] {
  const out: Timed[] = [];
  const [tjump, dur, traw] = [TJUMP[kind]!, DUR[kind]!, TRAW[kind]!];
  const fl = FLAGS + kind * FLAG_K;
  let prevEnd = 0;
  let prevDur = 0;
  let tflag = 1;
  let dflag = 1;
  let shp = 0;
  let dctx = 0;
  const ht = [new Float64Array(4), new Float64Array(4)];
  const hv = [new Float64Array(4), new Float64Array(4)];
  const hn = [0, 0];
  const last = [new Float64Array(4), new Float64Array(4)];
  const vctx = [0, 0];
  const vsign = [0, 0];
  const jctx = [0, 0];
  const prevV = [0, 0];
  const vflag = [1, 1];
  const seen = [0, 0];
  const pr = new Float64Array(4);
  for (let i = 0; i < n; i++) {
    const ev: Timed = { start: 0, end: 0, a: 0, b: 0, a2: 0, b2: 0, shape: 0 };
    // times
    if (i === 0) ev.start = unordf(dec.res(tjump, 0));
    else {
      tflag = dec.bit(fl + tflag);
      ev.start = tflag ? prevEnd : unordf(ordf(prevEnd) + dec.res(tjump, 0));
    }
    const ts = bitsToF64(ev.start);
    dflag = dec.bit(fl + 2 + dflag);
    if (dflag) {
      const d = dec.res(dur, dctx);
      const duration = prevDur + d;
      dctx = Math.min(bucket(d), CAP - 1);
      prevDur = duration;
      ev.end = f64ToBits(ts + duration);
    } else ev.end = unordf(ordf(ev.start) + dec.res(traw, 0));
    prevEnd = ev.end;
    const te = bitsToF64(ev.end);
    // shape: speed events with floorPosition; judge line events with start2/end2
    shp = dec.bit(fl + 4 + shp);
    ev.shape = shp;
    const nch = kind === 0 ? 1 : shp ? 2 : 1;
    for (let c = 0; c < nch; c++) {
      const [vjump, val] = [VJUMP[kind]![c]!, VAL[kind]![c]!];
      if (kind === 0) {
        const r = dec.res(val, vctx[0]!);
        ev.a = unordf(ordf(prevV[0]!) + r);
        vctx[0] = Math.min(bucket(r), CAP - 1);
        prevV[0] = ev.a;
        continue;
      }
      let cont = 0;
      if (seen[c]) {
        cont = dec.bit(fl + 6 + c * 2 + vflag[c]!);
        vflag[c] = cont;
      }
      let va: number;
      if (cont) va = prevV[c]!;
      else {
        const r = dec.res(vjump, jctx[c]!);
        va = unordf(ordf(prevV[c]!) + r);
        jctx[c] = Math.min(bucket(r), CAP - 1);
        hn[c] = 0;
      }
      seen[c] = 1;
      const kt = ht[c]!;
      const kv = hv[c]!;
      if (hn[c] === 0) {
        kt[0] = ts;
        kv[0] = bitsToF64(va);
        hn[c] = 1;
      }
      const k = hn[c]!;
      for (let o = 0; o < 4; o++)
        pr[o] = o < k ? (o > 0 ? predict(kt, kv, k, te, o) : kv[k - 1]!) : pr[o - 1]!;
      const errs = last[c]!;
      let best = 0;
      for (let o = 1; o < 4; o++) if (errs[o]! < errs[best]!) best = o;
      const pb = f64ToBits(pr[best]!);
      const r = dec.res(val, (best * CAP + vctx[c]!) * 2 + vsign[c]!);
      const vb = unordf(ordf(pb) + r);
      vctx[c] = Math.min(bucket(r), CAP - 1);
      vsign[c] = r < 0 ? 1 : 0;
      for (let o = 0; o < 4; o++) errs[o] = Math.abs(ordf(vb) - ordf(f64ToBits(pr[o]!)));
      const y = bitsToF64(vb);
      if (!(te > kt[hn[c]! - 1]!)) {
        kt[0] = te;
        kv[0] = y;
        hn[c] = 1;
      } else {
        if (hn[c] === 4) {
          for (let m = 0; m < 3; m++) {
            kt[m] = kt[m + 1]!;
            kv[m] = kv[m + 1]!;
          }
          hn[c] = 3;
        }
        kt[hn[c]!] = te;
        kv[hn[c]!] = y;
        hn[c] = hn[c]! + 1;
      }
      prevV[c] = vb;
      if (c === 0) {
        ev.a = va;
        ev.b = vb;
      } else {
        ev.a2 = va;
        ev.b2 = vb;
      }
    }
    out.push(ev);
  }
  return out;
}

// ---------------------------------------------------------------- notes
/** The line's floor position at `tick`, integrating its speed events from t = 0 (codec.py's speed_floor). */
function speedFloor(sp: Timed[], bpm: number, tick: number) {
  const ns = sp.length;
  if (ns === 0) return 0;
  const t = (tick * 1.875) / bpm;
  let fp = 0;
  let prevS = 0;
  let prevV = 0;
  for (let i = 0; i < ns; i++) {
    const s = Math.max(0, (bitsToF64(sp[i]!.start) * 1.875) / bpm);
    if (i > 0) fp += (s - prevS) * prevV;
    const e = (bitsToF64(sp[i]!.end) * 1.875) / bpm;
    const v = bitsToF64(sp[i]!.a);
    if (e >= t || i === ns - 1) return fp + (t - s) * v;
    prevS = s;
    prevV = v;
  }
  return fp;
}

type RawNote = RawChart["judgeLineList"][number]["notesAbove"][number];

function decodeNotes(dec: Decoder, n: number, sp: Timed[], bpm: number): RawNote[] {
  const notes: RawNote[] = [];
  let prevType = 0;
  let prevTime = 0;
  let prevPos = 0;
  let prevHold = 0;
  const prevSpeed = [0, 0];
  let cTime = 0;
  let cPos = 0;
  let cHold = 0;
  let cFp = 0;
  const cache = new Array<number>(POS_CACHE).fill(0);
  let ncache = 0;
  let hit = 0;
  for (let i = 0; i < n; i++) {
    const type = prevType + dec.res(N_TYPE, Math.min(prevType, 4));
    prevType = type;
    let r = dec.res(N_TIME, cTime);
    const time = prevTime + r;
    cTime = Math.min(bucket(r), CAP - 1);
    prevTime = time;
    // position: a hit in the move-to-front cache of recent positions, or a step from the previous one
    hit = ncache > 0 ? dec.bit(NOTE_FLAGS + 2 + hit) : 0;
    let pos: number;
    let idx: number;
    if (hit) {
      let node = 1;
      for (let k = 0; k < 5; k++) node = node * 2 + dec.bit(NOTE_FLAGS + 8 + node - 1);
      idx = node - 32;
      pos = cache[idx]!;
    } else {
      r = dec.res(N_POS, cPos);
      pos = unordf(ordf(prevPos) + r);
      cPos = Math.min(bucket(r), CAP - 1);
      idx = ncache < POS_CACHE ? ncache : POS_CACHE - 1;
      if (ncache < POS_CACHE) ncache++;
    }
    for (let m = idx; m > 0; m--) cache[m] = cache[m - 1]!;
    cache[0] = pos;
    prevPos = pos;
    // hold time: integral ticks (holds relative to the previous hold), else raw bits
    const isHold = type === 3 ? 1 : 0;
    let hold: number;
    if (dec.bit(NOTE_FLAGS + isHold)) {
      const base = isHold ? prevHold : 0;
      r = dec.res(N_HOLDI, isHold ? cHold : CAP - 1);
      const ticks = base + r;
      if (isHold) {
        cHold = Math.min(bucket(r), CAP - 2);
        prevHold = ticks;
      }
      hold = f64ToBits(ticks);
    } else hold = unordf(dec.res(N_HOLDR, 0));
    r = dec.res(N_SPEED, isHold);
    const speed = unordf(ordf(prevSpeed[isHold]!) + r);
    prevSpeed[isHold] = speed;
    const pb = f64ToBits(speedFloor(sp, bpm, time));
    r = dec.res(N_FP, cFp);
    const fp = unordf(ordf(pb) + r);
    cFp = Math.min(bucket(r), CAP - 1);
    notes.push({
      type: type as NoteType,
      time,
      positionX: bitsToF64(pos),
      holdTime: bitsToF64(hold),
      speed: bitsToF64(speed),
      floorPosition: bitsToF64(fp),
    });
  }
  return notes;
}

// ---------------------------------------------------------------- container
function readVarint(buf: Uint8Array, at: number): [number, number] {
  let n = 0;
  let scale = 1;
  for (;;) {
    const b = buf[at++]!;
    n += (b & 0x7f) * scale;
    scale *= 128;
    if (b < 0x80) return [n, at];
  }
}

const EVENT_KEYS = [
  "judgeLineMoveEvents",
  "judgeLineRotateEvents",
  "judgeLineDisappearEvents",
] as const;

/**
 * Decodes a .phc file into the chart's JSON structure (every value exactly as in the raw file, as f32). Modes 2 and 4
 * carry a patch that only restores how some numbers were written in the raw text; the values don't need it.
 */
export function decodePhc(data: Uint8Array): RawChart {
  const mode = data[0];
  let payload: Uint8Array;
  if (mode === 1 || mode === 3) payload = data.subarray(1);
  else if (mode === 2 || mode === 4) {
    const [length, at] = readVarint(data, 1);
    payload = data.subarray(at, at + length);
  } else throw new Error(`Unsupported .phc mode ${mode}`);
  const dec = new Decoder(payload);
  const formatVersion = dec.int();
  const topShape = dec.int();
  const numOfNotes = topShape === 1 ? dec.int() : undefined;
  const offset = bitsToF64(dec.f32bits());
  const lineCount = dec.int();
  const heads = range(lineCount, () => {
    const shape = dec.int();
    const counts = shape === 1 ? [dec.int(), dec.int(), dec.int()] : undefined;
    const bpm = bitsToF64(dec.f32bits());
    return { shape, counts, bpm, sizes: range(6, () => dec.int()) };
  });
  const judgeLineList = heads.map(({ shape, counts, bpm, sizes: [ns, na, nb, ...events] }) => {
    const sp = decodeTimed(dec, 0, ns!);
    const speedEvents = sp.map((e) => ({
      startTime: bitsToF64(e.start),
      endTime: bitsToF64(e.end),
      value: bitsToF64(e.a),
      ...(e.shape ? { floorPosition: 0 } : {}),
    }));
    // the rare speed floor positions, predicted from the integrated speed at the event's start
    sp.forEach((e, i) => {
      if (!e.shape) return;
      const pb = f64ToBits(speedFloor(sp, bpm, bitsToF64(e.start)));
      Object.assign(speedEvents[i]!, {
        floorPosition: bitsToF64(unordf(ordf(pb) + dec.res(S_FP, 0))),
      });
    });
    const notesAbove = decodeNotes(dec, na!, sp, bpm);
    const notesBelow = decodeNotes(dec, nb!, sp, bpm);
    const line = {
      ...(shape === 1
        ? { numOfNotes: counts![0], numOfNotesAbove: counts![1], numOfNotesBelow: counts![2] }
        : {}),
      bpm,
      notesAbove,
      notesBelow,
      speedEvents,
    } as RawChart["judgeLineList"][number];
    EVENT_KEYS.forEach((key, kind) => {
      line[key] = decodeTimed(dec, kind + 1, events[kind]!).map((e) => ({
        startTime: bitsToF64(e.start),
        endTime: bitsToF64(e.end),
        start: bitsToF64(e.a),
        end: bitsToF64(e.b),
        ...(e.shape ? { start2: bitsToF64(e.a2), end2: bitsToF64(e.b2) } : {}),
      }));
    });
    return line;
  });
  return {
    formatVersion,
    offset,
    ...(numOfNotes === undefined ? {} : { numOfNotes }),
    judgeLineList,
  } as RawChart;
}
