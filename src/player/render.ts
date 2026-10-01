import { score7 } from "../components/primitives";
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
export type Art = Record<(typeof NOTES)[number], HTMLImageElement> & { hit: HTMLCanvasElement };

const NOTE_W = 989;
const HOLD_CAP = 50;
const HOLD_BODY_HL_W = 1060;
const LINE_COLOR = "#feffa9";
const LINE_THICKNESS = 7.5;

const HIT_LIFE = 0.5;
const HIT_FRAMES = 30;
const HIT_CELL = 256;
const HIT_TINT = "rgb(255 236 160)";
const HIT_ALPHA = 0.88;
const HIT_SCALE = 6;

const HUD_FONT = '"Saira HUD", Saira, sans-serif';

function image(src: string) {
  const img = new Image();
  img.src = src;
  return img.decode().then(() => img);
}

function tint(img: HTMLImageElement, color: string) {
  const el = document.createElement("canvas");
  el.width = img.width;
  el.height = img.height;
  const ctx = el.getContext("2d")!;
  ctx.drawImage(img, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, el.width, el.height);
  ctx.globalCompositeOperation = "destination-in";
  ctx.drawImage(img, 0, 0);
  return el;
}

let artLoading: Promise<Art> | undefined;
export function loadArt() {
  artLoading ??= Promise.all([
    Promise.all([
      ...NOTES.map(async (name) => [name, await image(`/player/${name}.png`)] as const),
      image("/player/hit.png").then((sheet) => ["hit", tint(sheet, HIT_TINT)] as const),
    ]),
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

function drawHit(
  ctx: CanvasRenderingContext2D,
  sheet: HTMLCanvasElement,
  x: number,
  y: number,
  p: number,
  unit: number,
  seed: number,
) {
  const frame = Math.min(HIT_FRAMES - 1, Math.floor(p * HIT_FRAMES));
  const size = HIT_CELL * unit;
  ctx.setTransform(1, 0, 0, 1, x, y);
  ctx.globalAlpha = HIT_ALPHA;
  ctx.drawImage(
    sheet,
    (frame % 6) * HIT_CELL,
    Math.floor(frame / 6) * HIT_CELL,
    HIT_CELL,
    HIT_CELL,
    -size / 2,
    -size / 2,
    size,
    size,
  );
  ctx.globalAlpha = 1 - p;
  ctx.fillStyle = HIT_TINT;
  const side = 30 * (((0.2078 * p - 1.6524) * p + 1.6399) * p + 0.4988) * unit;
  for (let i = 0; i < 4; i++) {
    const reach = (185 + 80 * noise(seed + i)) * ((9 * p) / (8 * p + 1)) * unit;
    const angle = 2 * Math.PI * noise(seed * 7 + i);
    ctx.fillRect(
      Math.cos(angle) * reach - side / 2,
      Math.sin(angle) * reach - side / 2,
      side,
      side,
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
  const hits: { x: number; y: number; p: number; seed: number }[] = [];
  const hitAt = (line: Line, n: Note, when: number) => {
    const at = pose(line, when, W, H);
    hits.push({
      x: at.x + at.cos * n.x * unitX,
      y: at.y + at.sin * n.x * unitX,
      p: (t - when) / HIT_LIFE,
      seed: noise(when + n.x),
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
      if (n.type === 3 && since >= 0 && since < n.holdSec + HIT_LIFE) {
        const last = Math.floor(Math.min(since, n.holdSec) / every);
        for (let i = Math.max(0, Math.ceil((since - HIT_LIFE) / every)); i <= last; i++)
          hitAt(line, n, n.sec + i * every);
      } else if (n.type !== 3 && since >= 0 && since < HIT_LIFE) hitAt(line, n, n.sec);
      if (since >= n.holdSec) continue; // hit (holds: released)
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
      if (y < -0.001) continue;
      const name = ({ 1: "tap", 2: "drag", 4: "flick" } as const)[n.type];
      put(art[n.multi ? (`${name}-hl` as const) : name], x, -y * unitY);
    }
  }
  for (const hit of hits) drawHit(ctx, art.hit, hit.x, hit.y, hit.p, HIT_SCALE * k, hit.seed);
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
) {
  const px = H / 1080;
  const right = W / px;
  const combo = countUpTo(chart.judged, t, (x) => x);
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
  text(score7((1_000_000 * combo) / chart.noteCount), right - 40.5, 79.2, 60.6, "right");
  // title & level stop short of the center (cuz we have our cute watermark here!!)
  text(title, 48.4, 1043, 42.7, "left", { maxWidth: right / 2 - 190 });
  text(level, right - 43.2, 1041, 37.75, "right", { maxWidth: right / 2 - 190 });
  drawCredit(ctx, (right / 2) * px, 1041 * px, 30 * px);
  if (combo >= 3) {
    text(String(combo), right / 2, 80, 82, "center");
    text("combo", right / 2, 117.4, 39, "center", { family: "Saira, sans-serif" });
  }
}
