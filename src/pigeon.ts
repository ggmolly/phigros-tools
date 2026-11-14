/**
 * A Phigros++ replay (`mod/phigrospp/lua/replayfile.lua`): its header and the range coded frames. Uploaded, it's
 * followed by the player's public key and an ed25519 signature of `REPLAY_DOMAIN` and everything before them.
 */
export const REPLAY_DOMAIN = "phigros++ replay v5\0";
export const REPLAY_SIGNED = 96;
const MAGIC = "PIGEON";
const VERSION = 5;

export interface ReplayHeader {
  id: string;
  difficulty: string;
  width: number;
  height: number;
  date: number;
  score: number;
  accuracy: number;
  maxcombo: number;
  perfect: number;
  good: number;
  bad: number;
  miss: number;
  early: number;
  late: number;
  duration: number;
  game: number;
  phigrospp: string;
  device: string;
  android: string;
  refresh: number;
  fps: number;
  offset: number;
  files: string;
  /** what the judgement depends on: the screen's dpi (flicks), and 1 for mirror or challenge mode */
  dpi: number;
  mirror: number;
  challenge: number;
}

// the header's fields after the version byte, with their string.pack formats
const FIELDS: [keyof ReplayHeader, Format][] = [
  ["id", "s1"],
  ["difficulty", "s1"],
  ["width", "I2"],
  ["height", "I2"],
  ["date", "i8"],
  ["score", "i4"],
  ["accuracy", "f"],
  ["maxcombo", "I2"],
  ["perfect", "I2"],
  ["good", "I2"],
  ["bad", "I2"],
  ["miss", "I2"],
  ["early", "I2"],
  ["late", "I2"],
  ["duration", "f"],
  ["game", "I4"],
  ["phigrospp", "s1"],
  ["device", "s1"],
  ["android", "s1"],
  ["refresh", "d"],
  ["fps", "i2"],
  ["offset", "f"],
  ["files", "s2"],
  ["dpi", "f"],
  ["mirror", "B"],
  ["challenge", "B"],
];
type Format = "B" | "s1" | "s2" | "I2" | "i2" | "I4" | "i4" | "i8" | "f" | "d";

const decoder = new TextDecoder("utf-8", { fatal: true });

/** The header of a replay in the current format and where its frames start, throwing on anything else. */
function readHeader(bytes: Uint8Array): [ReplayHeader, number] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let at = 0;
  // the offset of the next n bytes, DataView throws past the end
  const next = (n: number) => {
    at += n;
    return at - n;
  };
  const text = (n: number) => {
    if (at + n > bytes.length) throw new RangeError("Replay header cut short");
    return decoder.decode(bytes.subarray(next(n), at));
  };
  const read: Record<Format, () => string | number> = {
    B: () => view.getUint8(next(1)),
    s1: () => text(view.getUint8(next(1))),
    s2: () => text(view.getUint16(next(2), true)),
    I2: () => view.getUint16(next(2), true),
    i2: () => view.getInt16(next(2), true),
    I4: () => view.getUint32(next(4), true),
    i4: () => view.getInt32(next(4), true),
    i8: () => Number(view.getBigInt64(next(8), true)),
    f: () => view.getFloat32(next(4), true),
    d: () => view.getFloat64(next(8), true),
  };
  if (text(MAGIC.length) !== MAGIC || read.B() !== VERSION)
    throw new Error("Not a Phigros++ replay of this version");
  const header: Record<string, string | number> = {};
  for (const [name, format] of FIELDS) header[name] = read[format]();
  return [header as unknown as ReplayHeader, at];
}

/** The header of a replay in the current format, throwing on anything else. */
export const replayHeader = (bytes: Uint8Array) => readHeader(bytes)[0];

/** A finger on a frame, in screen pixels from the bottom left like Unity reports them. */
export interface ReplayTouch {
  id: number;
  /** Unity's TouchPhase: 0 began, 1 moved, 2 stationary, 3 ended, 4 canceled. */
  phase: number;
  x: number;
  y: number;
}

/** A recorded frame: the song time and delta time in seconds, and the fingers. */
export interface ReplayFrame {
  t: number;
  dt: number;
  touches: ReplayTouch[];
}

// the decoder of mod/phigrospp/lua/replayfile.lua, read alongside it: the same adaptive binary range coder, the same
// contexts by the same names, and the same predictions, so every value comes back bit for bit
const BITS = 15;
const LIMIT = 30;
const MANT = 16;
const ONE = 1 << BITS;
const TOP = 2 ** 24;
const U32 = 2 ** 32;
const ENDED = 3;
const CANCELED = 4;

const float32 = new DataView(new ArrayBuffer(4));
// f32 <-> an integer ordered like the float
function ordf(x: number) {
  float32.setFloat32(0, x, true);
  const bits = float32.getUint32(0, true);
  return bits < 0x80000000 ? bits : -1 - (bits - 0x80000000);
}
function unordf(o: number) {
  float32.setUint32(0, o >= 0 ? o : -1 - o + 0x80000000, true);
  return float32.getFloat32(0, true);
}
function bucket(v: number, cap: number) {
  let n = 0;
  for (let a = Math.abs(v); a > 0 && n < cap; a = Math.floor(a / 2)) n++;
  return n;
}
const signedBucket = (v: number, cap: number) => (v < 0 ? -bucket(v, cap) : bucket(v, cap));
const near = (v: number, cap: number) => Math.max(-cap, Math.min(cap, v));
const join = (n: number, rest: number, grid: number) =>
  Math.floor((n * 1024 + Math.floor(grid / 2)) / grid) + rest;
const us = (seconds: number) => Math.floor(seconds * 1e6 + 0.5);

class Decoder {
  private range = U32 - 1;
  private code = 0;
  private pos = 0;
  /** int contexts by name, and the bits kept directly in it by name (Lua's c.contexts holds both) */
  readonly contexts = new Map<string, Map<number, number> | number>();

  constructor(private readonly data: Uint8Array) {
    for (let i = 0; i < 5; i++) this.code = (this.code * 256 + this.byte()) % U32;
  }

  private byte() {
    return this.data[this.pos++] ?? 0;
  }

  private normalize() {
    while (this.range < TOP) {
      this.range = (this.range * 256) % U32;
      this.code = (this.code * 256 + this.byte()) % U32;
    }
  }

  /** a bit with the adaptive probability of a 0, kept above the count of bits seen */
  bit(probs: Map<number | string, number>, key: number | string) {
    const state = probs.get(key) ?? ONE << 4;
    let p = state >> 5;
    const n = state & 31;
    const bound = Math.floor(this.range / ONE) * p;
    let b: number;
    if (this.code < bound) {
      b = 0;
      this.range = bound;
      p += Math.floor((ONE - p) / (n + 2));
    } else {
      b = 1;
      this.code -= bound;
      this.range -= bound;
      p -= Math.floor(p / (n + 2));
    }
    probs.set(key, (p << 5) | Math.min(n + 1, LIMIT));
    this.normalize();
    return b;
  }

  /** a bit kept directly in the contexts, under a name */
  flag(name: string) {
    return this.bit(this.contexts as Map<number | string, number>, name);
  }

  private raw(n: number) {
    let r = 0;
    for (let i = 0; i < n; i++) {
      this.range = Math.floor(this.range / 2);
      const b = this.code >= this.range ? 1 : 0;
      if (b) this.code -= this.range;
      r = r * 2 + b;
      this.normalize();
    }
    return r;
  }

  /** a signed integer: its bit length through a 6 level tree, a sign, MANT adaptive bits, the rest raw */
  int(name: string) {
    let probs = this.contexts.get(name) as Map<number, number> | undefined;
    if (!probs) {
      probs = new Map();
      this.contexts.set(name, probs);
    }
    let node = 1;
    for (let i = 0; i < 6; i++) node = node * 2 + this.bit(probs, node);
    const n = node - 64;
    if (n === 0) return 0;
    const negative = this.bit(probs, 64);
    const below = n - 1;
    let m = 1;
    const adaptive = Math.min(MANT, below);
    for (let i = 1; i <= adaptive; i++) m = m * 2 + this.bit(probs, 100 + (n << (MANT + 1)) + m);
    const rest = below - adaptive;
    if (rest > 0) m = m * 2 ** rest + this.raw(rest);
    return negative ? -m : m;
  }
}

interface Finger {
  id: number;
  phase: number;
  nx: number;
  rx: number;
  ny: number;
  ry: number;
  vx: number;
  vy: number;
  moves: number;
}

/** A replay's header and frames. An uploaded one ends with its signature, which is left out. */
export function decodeReplay(
  bytes: Uint8Array,
  signed = false,
): { header: ReplayHeader; frames: ReplayFrame[] } {
  const [header, start] = readHeader(bytes);
  const c = new Decoder(bytes.subarray(start, signed ? -REPLAY_SIGNED : undefined));
  const float = (name: string, predicted: number) => unordf(ordf(predicted) + c.int(name));
  const frames: ReplayFrame[] = [];
  let t1 = 0;
  let guess = 0;
  let rdt = 0;
  let fix = 0;
  let fix2 = 0;
  const clock = { scale: 1, mono: 0, real: 0, dsp: 0, dspStep: 0, music: 0, focus: 1 };
  let fingers: Finger[] = [];
  const count = c.int("count");
  const grid = c.int("grid");
  for (let k = 0; k < count; k++) {
    rdt = c.int(`dt${near(Math.floor(rdt / 8), 6)}`);
    const dt = unordf(guess + rdt);
    guess += Math.floor(rdt / 2);
    const step = ordf(Math.fround(t1 + dt));
    const correction = c.int(`t${signedBucket(fix, 3)}.${signedBucket(fix - fix2, 3)}`);
    fix2 = fix;
    fix += correction;
    const t = unordf(step + fix);

    const alive = fingers.filter((f) => f.phase !== ENDED && f.phase !== CANCELED);
    const used = new Set(alive.map((f) => f.id));
    const order: (Finger | { id: number } | undefined)[] = [];
    if (c.flag("regular") === 1) {
      order.push(...alive);
      for (let i = c.int("new"); i > 0; i--) order.push(undefined);
    } else {
      const byId = new Map(alive.map((f) => [f.id, f]));
      for (let i = c.int("listed"); i > 0; i--) {
        const id = c.int("id");
        order.push(byId.get(id) ?? { id });
      }
    }

    const now: Finger[] = [];
    for (const last of order) {
      let f: Finger;
      if (last && "nx" in last) {
        const phase = c.int(`phase${last.phase}${last.moves}`);
        const moved = c.flag(`moved${phase}${last.moves}`);
        f = { ...last, phase, moves: ((last.moves << 1) | moved) & 3 };
        if (moved) {
          f.vx = last.vx + c.int(`dx${phase}`);
          f.vy = last.vy + c.int(`dy${phase}.${bucket(f.vx - last.vx, 8)}`);
          f.nx = last.nx + f.vx;
          f.ny = last.ny + f.vy;
          f.rx = c.int(`rx${near(f.vx, 2)}${last.rx === 0 ? "=" : ""}`);
          f.ry = c.int(`ry${near(f.vy, 2)}${f.rx === 0 ? "=" : ""}`);
        }
      } else {
        let id = last?.id;
        if (id === undefined) {
          let free = 0;
          while (used.has(free)) free++;
          id = free + c.int("newid");
        }
        const phase = c.int("phase");
        const nx = c.int("x");
        const ny = c.int("y");
        const rx = c.int("rx");
        const ry = c.int(`ry${rx === 0 ? "=" : ""}`);
        f = { id, phase, nx, ny, rx, ry, vx: 0, vy: 0, moves: 0 };
      }
      used.add(f.id);
      now.push(f);
    }
    fingers = now;

    // the other clocks are decoded to stay in step with the stream, a viewer doesn't use them
    const udt = float("udt", dt);
    clock.scale = float("scale", clock.scale);
    const mono = clock.mono + us(udt) + c.int("mono");
    clock.real = float("real", Math.fround(clock.real + (mono - clock.mono) / 1e6));
    clock.mono = mono;
    clock.dspStep = c.int(`dsp${bucket(clock.dspStep, 20)}`);
    clock.dsp += clock.dspStep;
    clock.music = float("music", Math.fround(clock.music + clock.dspStep / 1e6));
    clock.focus = c.flag(`focus${clock.focus}`);

    frames.push({
      t,
      dt,
      touches: now.map((f) => ({
        id: f.id,
        phase: f.phase,
        x: join(f.nx, f.rx, grid) / 1024,
        y: join(f.ny, f.ry, grid) / 1024,
      })),
    });
    t1 = t;
  }
  return { header, frames };
}
