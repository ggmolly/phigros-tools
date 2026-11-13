import { rankOf, score7 } from "../components/primitives";
import {
  type Chart,
  countUpTo,
  type Line,
  lineFloor,
  linePose,
  type Note,
  segmentAt,
  valueAt,
} from "./chart";

const NOTES = [
  "tap",
  "tap-hl",
  "drag",
  "drag-hl",
  "flick",
  "flick-hl",
  "hold-head",
  "hold-head-hl",
  "hold-body",
  "hold-body-hl",
  "hold-end",
] as const;
export type Art = Record<(typeof NOTES)[number], HTMLImageElement>;

/**
 * A played chart, from a replay's judgement: each note's judgement and when it happened (hit or missed), and the
 * combo and score at a time. Without one, every note is drawn as hit on time.
 */
export interface Play {
  /** hit: when it was hit (a hold: its head, also when dropped later), end: when its judgement came */
  judged: Map<Note, { judgement: "perfect" | "good" | "bad" | "miss"; hit?: number; end: number }>;
  /** counts: the perfects, goods, bads and misses judged so far */
  state: (t: number) => {
    combo: number;
    score: number;
    maxcombo: number;
    counts: [number, number, number, number];
  };
  /** the hits with a timing (drags and flicks have none) by time: ms late (negative early), and osu!'s running average */
  timing: { at: number; ms: number; judgement: "perfect" | "good" | "bad"; average: number }[];
  /** the perfect, good and bad windows in ms */
  windows: [number, number, number];
}

const NOTE_W = 989;
const HOLD_CAP = 50;
const HOLD_BODY_HL_W = 1060;
const LINE_COLOR = "#feffa9";
const LINE_THICKNESS = 7.5;

const HIT_LIFE = 0.5;
const HIT_FRAMES = 30;
const HIT_TINT = "255 236 160";
// the timing bar, like the Phigros++ HUD (mod/mods/hud.lua) scaled to this score font
const JUDGE_COLORS = { perfect: "#ffeca0", good: "#a2eeff", bad: "#e2696d" };
const BAR = { length: 510, thickness: 3.6, tick: 19.4, ticks: 50, y: 985 };
const GOOD_TINT = "160 225 255";
const MISSED_LIFE = 0.25; // a missed note fades out past its line
const HIT_ALPHA = 0.88;
const HIT_SCALE = 6;

const HUD_FONT = '"Saira HUD", Saira, sans-serif';

function image(src: string) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

let artLoading: Promise<Art> | undefined;
export function loadArt() {
  artLoading ??= Promise.all([
    Promise.all(NOTES.map(async (name) => [name, await image(`/player/${name}.png`)] as const)),
    document.fonts.load(`40px ${HUD_FONT}`),
  ]).then(([entries]) => Object.fromEntries(entries) as Art);
  return artLoading;
}

/** Where a line is and how it's turned at t, in canvas pixels. */
function pose(line: Line, t: number, W: number, H: number) {
  const at = linePose(line, t);
  return { ...at, x: at.x * W, y: at.y * H };
}

// classic noise function for the particules
function noise(seed: number) {
  const x = Math.sin(seed * 12.9898) * 43758.5453;
  return x - Math.floor(x);
}

const clamp = (x: number) => Math.min(1, Math.max(0, x));

/**
 * The hit effect, drawn after the game's sheet of 30 frames (in its pixels, `unit` canvas pixels each): a disc that
 * shrinks, a diamond and a square that open around two turning arcs, and four squares thrown out. `tint` is the
 * colour's three channels.
 */
function drawHit(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  p: number,
  unit: number,
  seed: number,
  tint: string,
) {
  const frame = p * HIT_FRAMES;
  const tone = (alpha: number) => `rgb(${tint} / ${alpha})`;
  // lit from the top left, like the sheet
  const light = (near: number, far: number) => {
    const gradient = ctx.createLinearGradient(-90, -90, 90, 90);
    gradient.addColorStop(0, tone(near));
    gradient.addColorStop(1, tone(far));
    return gradient;
  };
  const fade = HIT_ALPHA * clamp((HIT_FRAMES - frame) / 8);
  const side = 86 * (1 - Math.exp(-frame / 2.4)) + 0.2 * frame; // half the square's
  // the diamond's corners, from its centre, and how thick its band is
  const corner = 68 + 44 * (1 - Math.exp((1 - frame) / 1.6)) + 0.2 * (frame - 1);
  const band = frame < 8 ? 68.2 - 6.2 * frame : Math.max(1.5, 18.6 * Math.exp((8 - frame) / 5));
  const hole = Math.max(0, corner - band);
  const turn = ((25 * p - 120) * Math.PI) / 180;
  ctx.setTransform(unit, 0, 0, unit, x, y);
  ctx.globalAlpha = fade * clamp(frame);
  ctx.fillStyle = light(0.36, 0.03);
  ctx.beginPath();
  for (const reach of [corner, hole]) {
    ctx.moveTo(0, -reach);
    ctx.lineTo(reach, 0);
    ctx.lineTo(0, reach);
    ctx.lineTo(-reach, 0);
    ctx.closePath();
  }
  ctx.fill("evenodd");
  ctx.strokeStyle = light(0.85, 0.12);
  ctx.lineWidth = 2.5;
  ctx.strokeRect(-side, -side, side * 2, side * 2);
  ctx.globalAlpha = fade * clamp(frame - 1.5);
  ctx.lineWidth = 4;
  for (const half of [0, Math.PI]) {
    ctx.beginPath();
    ctx.arc(0, 0, side * 0.83, turn + half, turn + half + 1.6);
    ctx.stroke();
  }
  ctx.globalAlpha = fade;
  ctx.fillStyle = tone(0.12 * clamp((frame - 5) / 2));
  ctx.beginPath();
  ctx.arc(0, 0, 24, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = light(0.95, 0.6);
  ctx.beginPath();
  ctx.arc(0, 0, 5 + 36 * Math.exp(-frame / 5), 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1 - p;
  ctx.fillStyle = tone(1);
  const size = 30 * (((0.2078 * p - 1.6524) * p + 1.6399) * p + 0.4988);
  for (let i = 0; i < 4; i++) {
    const reach = (185 + 80 * noise(seed + i)) * ((9 * p) / (8 * p + 1));
    const angle = 2 * Math.PI * noise(seed * 7 + i);
    ctx.fillRect(
      Math.cos(angle) * reach - size / 2,
      Math.sin(angle) * reach - size / 2,
      size,
      size,
    );
  }
}

export function drawScene(
  ctx: CanvasRenderingContext2D,
  art: Art,
  chart: Chart,
  t: number,
  W: number,
  H: number,
  play?: Play,
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  const unitX = W * 0.05625;
  const unitY = H * 0.6;
  const k = W / 8080; // canvas pixels per texture pixel
  const noteW = NOTE_W * k;
  const put = (img: HTMLImageElement, x: number, y: number) =>
    ctx.drawImage(
      img,
      x - (img.width * k) / 2,
      y - (img.height * k) / 2,
      img.width * k,
      img.height * k,
    );
  const hits: { x: number; y: number; p: number; seed: number; good: boolean }[] = [];
  const hitAt = (line: Line, n: Note, when: number, good = false) => {
    const at = pose(line, when, W, H);
    hits.push({
      x: at.x + at.cos * n.x * unitX,
      y: at.y + at.sin * n.x * unitX,
      p: (t - when) / HIT_LIFE,
      seed: noise(when + n.x),
      good,
    });
  };
  for (const line of chart.lines) {
    const { x: lx, y: ly, cos, sin } = pose(line, t, W, H);
    const alpha = Math.max(0, Math.min(1, valueAt(segmentAt(line.alpha, t), t)));
    if (alpha > 0) {
      const thickness = (H * LINE_THICKNESS) / 1080;
      ctx.globalAlpha = alpha;
      ctx.setTransform(cos, sin, -sin, cos, lx, ly);
      ctx.fillStyle = LINE_COLOR;
      ctx.fillRect(-W * 3, -thickness / 2, W * 6, thickness);
    }
    ctx.globalAlpha = 1;
    const floor = lineFloor(line, t);
    const every = 30 / line.bpm; // holds burst every half beat while held

    // god help me please
    for (const n of line.notes) {
      const since = t - n.sec;
      // played: effects where and when the note was hit, a hold bursts while held, a note never hit fades out
      const judged = play?.judged.get(n);
      const good = judged?.judgement === "good";
      const hit = play ? (judged?.judgement === "bad" ? undefined : judged?.hit) : n.sec;
      const release = Math.min(
        n.sec + n.holdSec,
        judged?.judgement === "miss" ? judged.end : Number.POSITIVE_INFINITY,
      );
      if (hit !== undefined && n.type === 3 && t >= hit && t < release + HIT_LIFE) {
        const last = Math.floor((Math.min(t, release) - hit) / every);
        for (let i = Math.max(0, Math.ceil((t - hit - HIT_LIFE) / every)); i <= last; i++)
          hitAt(line, n, hit + i * every, good);
      } else if (hit !== undefined && n.type !== 3 && t >= hit && t - hit < HIT_LIFE)
        hitAt(line, n, hit, good);
      const fading = play && hit === undefined && since > 0;
      if (
        fading
          ? since > MISSED_LIFE
          : n.type === 3
            ? since >= n.holdSec
            : hit !== undefined && t >= hit
      )
        continue;
      ctx.globalAlpha = fading ? 1 - since / MISSED_LIFE : 1;
      // notes below the line are drawn in a frame turned half a turn, so "up" points away from the line (if that makes any sense)
      const sign = n.above ? 1 : -1;
      const x = sign * n.x * unitX;
      ctx.setTransform(sign * cos, sign * sin, -sign * sin, sign * cos, lx, ly);
      if (n.type === 3) {
        const head = since >= 0 ? 0 : n.fp - floor;
        const tail = (since >= 0 ? -since * n.speed : head) + n.holdSec * n.speed;
        if (head < -0.001 && since < 0) continue; // behind its line: hidden until it comes round
        // head just below the hit point, the body stretched up to the release point, the end cap above it.
        const bottom = -head * unitY;
        const top = -tail * unitY;
        const cap = HOLD_CAP * k;
        const bodyW = (n.multi ? HOLD_BODY_HL_W : NOTE_W) * k;
        ctx.drawImage(
          art[n.multi ? "hold-body-hl" : "hold-body"],
          x - bodyW / 2,
          top,
          bodyW,
          bottom - top,
        );
        ctx.drawImage(art["hold-end"], x - noteW / 2, top - cap, noteW, cap);
        if (since < 0) put(art[n.multi ? "hold-head-hl" : "hold-head"], x, bottom + cap / 2);
        continue;
      }
      const y = (n.fp - floor) * n.speed;
      if (y < -0.001 && !fading) continue;
      const name = ({ 1: "tap", 2: "drag", 4: "flick" } as const)[n.type];
      put(art[n.multi ? (`${name}-hl` as const) : name], x, -y * unitY);
    }
  }
  ctx.globalAlpha = 1;
  for (const hit of hits)
    drawHit(ctx, hit.x, hit.y, hit.p, HIT_SCALE * k, hit.seed, hit.good ? GOOD_TINT : HIT_TINT);
  ctx.globalAlpha = 1;
}

// our cool small watermark
function drawCredit(ctx: CanvasRenderingContext2D, x: number, baseline: number, size: number) {
  const parts = [
    { text: "phigros", font: `500 ${size}px Saira, sans-serif`, color: "#fff" },
    { text: ".", font: `500 ${size}px Saira, sans-serif`, color: "#8fdcff" },
    { text: "tools", font: `300 ${size}px Saira, sans-serif`, color: "rgb(255 255 255 / 0.66)" },
  ];
  const widths = parts.map((part) => {
    ctx.font = part.font;
    return ctx.measureText(part.text).width;
  });
  let left = x - widths.reduce((sum, w) => sum + w, 0) / 2;
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.textAlign = "left";
  parts.forEach((part, i) => {
    ctx.font = part.font;
    ctx.fillStyle = part.color;
    ctx.fillText(part.text, left, baseline);
    left += widths[i]!;
  });
  ctx.restore();
}

export function drawHud(
  ctx: CanvasRenderingContext2D,
  chart: Chart,
  t: number,
  duration: number,
  W: number,
  H: number,
  title: string,
  level: string,
  play?: Play,
) {
  const px = H / 1080;
  const right = W / px;
  const state = play?.state(t);
  const combo = state ? state.combo : countUpTo(chart.judged, t, (x) => x);
  const text = (
    str: string,
    x: number,
    y: number,
    size: number,
    align: CanvasTextAlign,
    { family = HUD_FONT, maxWidth }: { family?: string; maxWidth?: number } = {},
  ) => {
    ctx.font = `${size * px}px ${family}`;
    ctx.textAlign = align;
    if (maxWidth) ctx.fillText(str, x * px, y * px, maxWidth * px);
    else ctx.fillText(str, x * px, y * px);
  };
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  const progress = W * Math.min(1, Math.max(0, t / duration));
  ctx.fillStyle = "rgb(145 145 145 / 0.88)";
  ctx.fillRect(0, 0, progress, 11 * px);
  ctx.fillStyle = "#fff";
  ctx.fillRect(progress - 2 * px, 0, 2 * px, 11 * px); // the progress bar's tip
  ctx.fillRect(30 * px, 1009 * px, 7 * px, 36 * px); // bar before the title
  ctx.textBaseline = "alphabetic";
  text(
    score7(state ? state.score : (1_000_000 * combo) / chart.noteCount),
    right - 40.5,
    79.2,
    60.6,
    "right",
  );
  // title & level stop short of the center (cuz we have our cute watermark here!!)
  text(title, 48.4, 1043, 42.7, "left", { maxWidth: right / 2 - 190 });
  text(level, right - 43.2, 1041, 37.75, "right", { maxWidth: right / 2 - 190 });
  drawCredit(ctx, (right / 2) * px, 1041 * px, 30 * px);
  if (combo >= 3) {
    text(String(combo), right / 2, 80, 82, "center");
    text("combo", right / 2, 117.4, 39, "center", { family: "Saira, sans-serif" });
  }
  if (play && state) drawJudgements(ctx, play, state, t, px, right, text);
}

const outQuint = (x: number) => 1 - (1 - x) ** 5;

// a replay's accuracy and the grade it's heading for under the score, and the hits' timings on a bar
function drawJudgements(
  ctx: CanvasRenderingContext2D,
  play: Play,
  state: ReturnType<Play["state"]>,
  t: number,
  px: number,
  right: number,
  text: (str: string, x: number, y: number, size: number, align: CanvasTextAlign) => void,
) {
  const [perfect, good, bad, miss] = state.counts;
  const judged = perfect + good + bad + miss;
  if (judged > 0) {
    const exact = (perfect + 0.65 * good) / judged;
    const fc = bad + miss === 0;
    // the grade if the rest of the chart goes like it went so far
    const pace = 900_000 * exact + (fc ? 100_000 : (100_000 * state.maxcombo) / judged);
    const rank = rankOf(Math.round(pace), fc);
    const accuracy = `${(Math.floor(exact * 10_000) / 100).toFixed(2)}%`;
    const size = 33.3;
    const y = 120;
    text(accuracy, right - 40.5, y, size, "right");
    const grade = right - 40.5 - ctx.measureText(accuracy).width / px - size * 0.35;
    ctx.fillStyle = rank === "φ" ? "#f5f25b" : fc ? "#4f8df5" : "#fff";
    text(rank, grade, rank === "φ" ? y - size * 0.12 : y, size, "right"); // φ sits low in this font
    ctx.fillStyle = "#fff";
  }

  const centre = right / 2;
  const x = (ms: number) => (Math.max(-1, Math.min(1, ms / play.windows[2])) * BAR.length) / 2;
  const rect = (cx: number, cy: number, w: number, h: number) =>
    ctx.fillRect((cx - w / 2) * px, (cy - h / 2) * px, w * px, h * px);
  (["bad", "good", "perfect"] as const).forEach((kind, i) => {
    ctx.fillStyle = JUDGE_COLORS[kind];
    rect(centre, BAR.y, x(play.windows[2 - i]!) * 2, BAR.thickness);
  });
  ctx.fillStyle = "#fff";
  rect(centre, BAR.y, 2, BAR.tick * 0.6);
  // osu! BarHitErrorMeter: a tick fades in over 100 ms, then fades and shrinks over 5 s
  const shown = countUpTo(play.timing, t, (hit) => hit.at);
  for (let i = shown - 1; i >= Math.max(0, shown - BAR.ticks); i--) {
    const hit = play.timing[i]!;
    const age = (t - hit.at) * 1000;
    if (age >= 5100) break;
    const fade = age < 100 ? outQuint(age / 100) : 1 - (age - 100) / 5000;
    const length = age < 100 ? outQuint(age / 100) : 1 - ((age - 100) / 5000) ** 5;
    ctx.globalAlpha = 0.6 * fade;
    ctx.fillStyle = JUDGE_COLORS[hit.judgement];
    rect(centre + x(hit.ms), BAR.y, BAR.thickness, BAR.tick * length);
  }
  ctx.globalAlpha = 1;
  // the running average, a small diamond under the bar
  const average = play.timing[shown - 1]?.average ?? 0;
  ctx.fillStyle = "#fff";
  ctx.save();
  ctx.translate((centre + x(average)) * px, (BAR.y + BAR.tick * 0.75) * px);
  ctx.rotate(Math.PI / 4);
  ctx.fillRect(-3.5 * px, -3.5 * px, 7 * px, 7 * px);
  ctx.restore();
}
