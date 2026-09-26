import { useEffect, useRef, useState } from "react";
import { catalogChartTotals } from "../catalog";
import type { ChartMetric, RankingResult } from "../metrics";
import { countLevels, LEVELS, type SongRecord } from "../modules";
import { currentPalette, FOG_LAYOUT } from "../palettes";
import { avatarUrl, rankOf } from "./primitives";

const SITE_URL = "https://phigros.tools";
const DEFAULT_NAME = "Unnamed Pigeon";
const W = 1600;
const H = 900;
const TAN = 0.25; // same slope as --skew in style.css
const FONT = "Saira, 'Segoe UI', sans-serif";
const LEVEL_COLORS: Record<string, string> = {
  EZ: "#4aa84a",
  HD: "#3a78c0",
  IN: "#c43a33",
  AT: "#4a4a52",
};

type CardData = {
  name: string;
  ranking: RankingResult;
  songs: SongRecord[];
  date: Date;
  palette: string[];
  avatar?: HTMLImageElement;
};
type Ctx = CanvasRenderingContext2D;

/** Parallelogram whose top edge leans right, matching skewX(--skew) around the centre. */
function paraPath(ctx: Ctx, x: number, y: number, w: number, h: number) {
  const o = (h * TAN) / 2;
  ctx.beginPath();
  ctx.moveTo(x + o, y);
  ctx.lineTo(x + w + o, y);
  ctx.lineTo(x + w - o, y + h);
  ctx.lineTo(x - o, y + h);
  ctx.closePath();
}
function para(ctx: Ctx, x: number, y: number, w: number, h: number, fill: string) {
  paraPath(ctx, x, y, w, h);
  ctx.fillStyle = fill;
  ctx.fill();
}

function text(
  ctx: Ctx,
  value: string,
  x: number,
  y: number,
  size: number,
  options: {
    weight?: number;
    color?: string;
    align?: CanvasTextAlign;
    max?: number;
    glow?: string;
  } = {},
) {
  ctx.font = `${options.weight ?? 400} ${size}px ${FONT}`;
  ctx.fillStyle = options.color ?? "#fff";
  ctx.textAlign = options.align ?? "left";
  let shown = value;
  if (options.max && ctx.measureText(shown).width > options.max) {
    while (shown.length > 1 && ctx.measureText(`${shown}…`).width > options.max)
      shown = shown.slice(0, -1);
    shown = `${shown.trimEnd()}…`;
  }
  if (options.glow) {
    ctx.shadowColor = options.glow;
    ctx.shadowBlur = size / 3;
  }
  ctx.fillText(shown, x, y);
  ctx.shadowBlur = 0;
  return ctx.measureText(shown).width;
}

/** The page's fog, redrawn with the same colours and layout as `.backdrop`. */
function background(ctx: Ctx, palette: string[]) {
  const rgb = palette.map((color) => {
    ctx.fillStyle = "#000";
    ctx.fillStyle = color; // the canvas normalises any CSS colour to #rrggbb
    const hex = String(ctx.fillStyle);
    return [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));
  });
  const centre = rgb[4]!;
  ctx.fillStyle = `rgb(${centre.map((value) => Math.round(value * 0.72)).join(",")})`;
  ctx.fillRect(0, 0, W, H);
  // CSS paints the first gradient on top, so draw corners first and the centre last.
  for (const index of [8, 6, 2, 0, 5, 3, 7, 1, 4]) {
    const [x, y, rx, ry] = FOG_LAYOUT[index]!;
    const color = rgb[index]!.join(",");
    ctx.save();
    ctx.translate(x * W, y * H);
    ctx.scale(rx * W, ry * H);
    const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    gradient.addColorStop(0, `rgba(${color},1)`);
    gradient.addColorStop(0.72, `rgba(${color},0)`);
    ctx.fillStyle = gradient;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  ctx.save();
  ctx.shadowColor = "rgba(255,255,255,.35)";
  ctx.shadowBlur = 30;
  for (const [bx, by, r] of [
    [0.03, 0.2, 34],
    [0.55, 0.05, 16],
    [0.97, 0.52, 40],
    [0.62, 0.95, 22],
  ] as const) {
    ctx.beginPath();
    ctx.arc(bx * W, by * H, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(255,255,255,.22)";
    ctx.fill();
  }
  ctx.restore();
}

function rankGlyph(ctx: Ctx, chart: ChartMetric, x: number, y: number, size: number) {
  const rank = rankOf(chart.score, chart.fc);
  const color = rank === "φ" ? "#f5f25b" : chart.fc ? "#4f8df5" : "#fff";
  text(ctx, rank, x, y, size, {
    weight: 600,
    color,
    align: "center",
    glow: rank === "φ" ? "rgba(245,242,91,.9)" : chart.fc ? "rgba(79,141,245,.8)" : undefined,
  });
}

function drawShareCard(ctx: Ctx, { name, ranking, songs, date, palette, avatar }: CardData) {
  const counts = countLevels(songs);
  const played = songs.reduce((sum, song) => sum + song.levels.filter(Boolean).length, 0);
  const fc = counts.reduce((sum, count) => sum + count.fc, 0);
  const ap = counts.reduce((sum, count) => sum + count.phi, 0);
  background(ctx, palette);
  ctx.textBaseline = "alphabetic";

  // Corner block with the white edge stripe, carrying the site name.
  para(ctx, -60, 0, 520, 96, "#000");
  para(ctx, 470, 0, 11, 96, "#fff");
  let x = 56 + text(ctx, "phigros", 56, 63, 44, { weight: 500 });
  x += text(ctx, ".", x, 63, 44, { weight: 500, color: "#8fdcff", glow: "#8fdcff" });
  text(ctx, "tools", x, 63, 44, { weight: 300, color: "rgba(255,255,255,.7)" });
  text(
    ctx,
    date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" }),
    W - 64,
    62,
    26,
    { color: "rgba(255,255,255,.7)", align: "right" },
  );

  // Profile ribbon + ranking score.
  // Avatar tile on the ribbon's left end, cut on the same slant, like the in-game profile.
  para(ctx, 40, 150, 740, 104, "#000");
  if (avatar) {
    ctx.save();
    paraPath(ctx, 40, 150, 132, 104);
    ctx.clip();
    ctx.drawImage(avatar, 40, 136, 132, 132);
    ctx.restore();
  }
  text(ctx, name || DEFAULT_NAME, avatar ? 204 : 104, 222, 56, { max: avatar ? 520 : 600 });
  para(ctx, 52, 282, 730, 176, "rgba(8,4,12,.55)");
  para(ctx, 76, 282, 170, 176, "#fff");
  text(ctx, "RKS", 162, 390, 52, { weight: 500, color: "#000", align: "center" });
  text(ctx, ranking.rankingScore.toFixed(3), 286, 418, 150, { weight: 300 });

  // Stat bar: value, small total, label underneath.
  para(ctx, 64, 490, 716, 118, "rgba(20,18,26,.78)");
  (
    [
      ["Charts Played", played, undefined],
      ["Full Combo", fc, played],
      ["All Perfect", ap, played],
    ] as const
  ).forEach(([label, value, total], index) => {
    const cx = 185 + index * 236;
    ctx.font = `400 60px ${FONT}`;
    const valueWidth = ctx.measureText(String(value)).width;
    ctx.font = `400 26px ${FONT}`;
    const totalWidth = total === undefined ? 0 : ctx.measureText(`/${total}`).width;
    const start = cx - (valueWidth + totalWidth) / 2;
    text(ctx, String(value), start, 562, 60);
    if (total !== undefined) text(ctx, `/${total}`, start + valueWidth, 562, 26);
    text(ctx, label, cx, 594, 22, { align: "center" });
  });

  // Per-difficulty cleared counts, laid out by measured width and shrunk until all four fit the left column.
  const TILE = 70,
    GAP = 14,
    SPACING = 30,
    COLUMN = 700;
  let size = 32;
  const widths = () =>
    LEVELS.map((_, index) => {
      ctx.font = `400 ${size}px ${FONT}`;
      const value = ctx.measureText(String(counts[index]!.cleared)).width;
      ctx.font = `400 ${Math.round(size * 0.56)}px ${FONT}`;
      return value + ctx.measureText(`/${catalogChartTotals[index]}`).width;
    });
  while (
    size > 18 &&
    widths().reduce((sum, width) => sum + TILE + GAP + width, 0) + SPACING * 3 > COLUMN
  )
    size -= 2;
  let lx = 76;
  widths().forEach((width, index) => {
    para(ctx, lx, 648, TILE, 46, counts[index]!.cleared ? "#fff" : "rgba(255,255,255,.45)");
    text(ctx, LEVELS[index]!, lx + TILE / 2, 681, 26, {
      weight: 500,
      color: "#000",
      align: "center",
    });
    const valueWidth = text(ctx, String(counts[index]!.cleared), lx + TILE + GAP, 684, size);
    text(
      ctx,
      `/${catalogChartTotals[index]}`,
      lx + TILE + GAP + valueWidth,
      684,
      Math.round(size * 0.56),
      { color: "rgba(255,255,255,.7)" },
    );
    lx += TILE + GAP + width + SPACING;
  });

  // Best charts, song-select style: the top one is the "selected" row with a white level box.
  para(ctx, 836, 150, 700, 64, "rgba(6,3,8,.8)");
  const bestWidth = text(ctx, "Best Charts", 874, 195, 34);
  text(
    ctx,
    ranking.ruleset === "b30" ? "B27 + 3 Phi" : "B19 + 1 Phi",
    874 + bestWidth + 20,
    195,
    20,
    { color: "rgba(255,255,255,.66)" },
  );
  ranking.best.slice(0, 8).forEach((chart, index) => {
    const top = 238 + index * 66;
    const baseline = top + 44;
    if (index === 0) {
      para(ctx, 846, top, 690, 62, "rgba(0,0,0,.72)");
      para(ctx, 1392, top, 138, 62, "#fff");
    }
    text(ctx, String(index + 1).padStart(2, "0"), 872, baseline - 4, 18, {
      color: "rgba(255,255,255,.45)",
    });
    text(ctx, chart.title, 916, baseline, 28, { max: 300 });
    para(ctx, 1234, top + 18, 54, 28, LEVEL_COLORS[chart.level]!);
    text(ctx, chart.level, 1261, top + 39, 16, { weight: 600, align: "center" });
    rankGlyph(ctx, chart, 1336, baseline + 2, 34);
    text(ctx, chart.rks.toFixed(2), 1461, baseline, 32, {
      color: index === 0 ? "#000" : "#fff",
      align: "center",
    });
  });
  if (!ranking.best.length)
    text(ctx, "No ranked charts yet", 874, 290, 26, { color: "rgba(255,255,255,.66)" });

  text(ctx, "Unofficial fan-made tool · Not affiliated with Pigeon Games", 64, 858, 18, {
    color: "rgba(255,255,255,.45)",
  });
}

function ShareIcon() {
  return (
    <svg
      className="button-arrow"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M12 15V3m-5 5 5-5 5 5M5 13v8h14v-8" />
    </svg>
  );
}

export function ShareCard({
  ranking,
  songs,
  playerName,
  avatar,
}: {
  ranking: RankingResult;
  songs: SongRecord[];
  playerName?: string;
  /** In-game avatar name. */
  avatar: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(playerName ?? "");
  const [image, setImage] = useState<{ url: string; blob: Blob }>();
  const [status, setStatus] = useState("");
  const [canShare, setCanShare] = useState(false);
  const rks = ranking.rankingScore.toFixed(3);
  const file = image && new File([image.blob], `phigros-rks-${rks}.png`, { type: "image/png" });
  const caption = `My Phigros RKS is ${rks}! Check yours at ${SITE_URL}`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | undefined;
    const timer = setTimeout(async () => {
      const avatarImage = new Image();
      avatarImage.src = avatarUrl(avatar);
      const [avatarLoaded] = await Promise.all([
        avatarImage.decode().then(
          () => true,
          () => false, // missing avatar: draw the card without it
        ),
        document.fonts.load(`300 100px Saira`),
        document.fonts.load(`600 40px Saira`),
      ]).catch(() => [false]);
      const canvas = document.createElement("canvas");
      canvas.width = W;
      canvas.height = H;
      drawShareCard(canvas.getContext("2d")!, {
        name: name.trim(),
        ranking,
        songs,
        date: new Date(),
        palette: currentPalette(),
        avatar: avatarLoaded ? avatarImage : undefined,
      });
      canvas.toBlob((blob) => {
        if (cancelled || !blob) return;
        url = URL.createObjectURL(blob);
        setImage({ url, blob });
        const probe = new File([blob], "card.png", { type: "image/png" });
        setCanShare(
          typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }),
        );
      }, "image/png");
    }, 150); // debounce typing in the name field
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, name, ranking, songs, avatar]);

  async function copy() {
    if (!image) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]);
      setStatus("Image copied to clipboard.");
    } catch {
      setStatus("Your browser blocked copying images. Use Download instead.");
    }
  }
  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "My Phigros profile", text: caption });
    } catch (error) {
      if ((error as DOMException).name !== "AbortError")
        setStatus("Sharing failed. Use Download instead.");
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn hero-share"
        onClick={() => {
          setStatus("");
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        Share card <ShareIcon />
      </button>
      <dialog
        ref={dialog}
        id="shareDialog"
        aria-labelledby="share-heading"
        onClose={() => setOpen(false)}
      >
        <form method="dialog" className="dialog-head">
          <h2 id="share-heading">Share Card</h2>
          {/* biome-ignore lint/a11y/useButtonType: the default submit type is intentional; submitting a method="dialog" form is how this button closes the dialog without JS. */}
          <button className="dialog-close" aria-label="Close share card dialog">
            ×
          </button>
        </form>
        <div className="share-preview">
          {image ? (
            <img
              src={image.url}
              width={W}
              height={H}
              alt={`Share card: ${name || DEFAULT_NAME}, RKS ${rks}, top charts`}
            />
          ) : (
            <p className="meta">Drawing your card…</p>
          )}
        </div>
        <div className="share-controls">
          <label className="share-name">
            <span className="field-label">Name on card</span>
            <input
              className="field"
              value={name}
              maxLength={40}
              placeholder={DEFAULT_NAME}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="share-actions">
            {canShare && (
              <button type="button" className="btn" disabled={!image} onClick={() => void share()}>
                Share <ShareIcon />
              </button>
            )}
            <a
              className={`btn${canShare ? " btn-ghost" : ""}`}
              href={image?.url}
              download={file?.name}
              aria-disabled={!image}
            >
              Download PNG
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!image}
              onClick={() => void copy()}
            >
              Copy image
            </button>
          </div>
        </div>
        <p className="meta share-status" aria-live="polite">
          {status}
        </p>
      </dialog>
    </>
  );
}
