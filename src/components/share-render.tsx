// satori calls these components as plain functions, outside React, so the React Compiler must not add hooks to them.
"use no memo";

import { initWasm, Resvg } from "@resvg/resvg-wasm";
import resvgWasm from "@resvg/resvg-wasm/index_bg.wasm?url";
import satori, { init as initSatori } from "satori/standalone";
import yogaWasm from "satori/yoga.wasm?url";
import { canonicalSongId, catalogChartTotals } from "../catalog";
import { type ChartMetric, fullComboBest, type RankingResult } from "../metrics";
import { countLevels, LEVELS, type SongRecord } from "../modules";
import { FOG_LAYOUT } from "../palettes";
import { avatarUrl, challengeRank, rankOf } from "./primitives";
import { CARD_SIZE, type CardFormat, DEFAULT_NAME } from "./share";

const { width: W, height: H } = CARD_SIZE.info;

/*
 * The share card as JSX, laid out by satori (flexbox, like the page) into an SVG and rasterised by resvg.
 * Loaded on demand by share.tsx: satori, the resvg wasm and the fonts only download once the share dialog opens.
 */

const TAN = 0.25; // same slope as --skew in style.css
const SKEW = `skewX(${(-Math.atan(TAN) * 180) / Math.PI}deg)`;
const DIM = "rgba(255,255,255,.7)";
const FAINT = "rgba(255,255,255,.45)";
const LEVEL_COLORS: Record<string, string> = {
  EZ: "#4aa84a",
  HD: "#3a78c0",
  IN: "#c43a33",
  AT: "#4a4a52",
};
const RIBBON = 104; // profile ribbon height; the avatar tile is cut to it

type Style = React.CSSProperties;

/**
 * A block with a parallelogram behind its content, skewed around its centre like `skewX(var(--skew))`. The shape
 * is its own layer so the content stays upright. Lay it out like any flex item.
 */
function Para({
  fill,
  style,
  children,
}: {
  fill: string;
  style?: Style;
  children?: React.ReactNode;
}) {
  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", ...style }}>
      <div
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          width: "100%",
          height: "100%",
          background: fill,
          transform: SKEW,
        }}
      />
      {children}
    </div>
  );
}

const row: Style = { display: "flex", alignItems: "center" };
const baseline: Style = { display: "flex", alignItems: "baseline", lineHeight: 1 };
const ellipsis: Style = { overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis" };

/** The page's fog, with the same colours and layout as `.backdrop`: centre colour darkened underneath, nine glows on top. */
function fog(palette: string[]): Style {
  const base = palette[4]!
    .slice(1)
    .match(/../g)!
    .map((hex) => Math.round(Number.parseInt(hex, 16) * 0.72));
  // CSS paints the first gradient on top: the centre, then edges, then corners.
  const glows = [4, 1, 7, 3, 5, 0, 2, 6, 8].map((index) => {
    const [x, y, rx, ry] = FOG_LAYOUT[index]!;
    return `radial-gradient(${rx * 100}% ${ry * 100}% at ${x * 100}% ${y * 100}%, ${palette[index]} 0%, transparent 72%)`;
  });
  return { backgroundColor: `rgb(${base.join(",")})`, backgroundImage: glows.join(", ") };
}

const BOKEH = [
  [0.03, 0.2, 34],
  [0.55, 0.05, 16],
  [0.97, 0.52, 40],
  [0.62, 0.95, 22],
] as const;

function bokeh(width: number, height: number) {
  return BOKEH.map(([x, y, r]) => (
    <div
      key={`${x}-${y}`}
      style={{
        position: "absolute",
        left: x * width - r,
        top: y * height - r,
        width: r * 2,
        height: r * 2,
        borderRadius: r,
        background: "rgba(255,255,255,.22)",
        boxShadow: "0 0 30px rgba(255,255,255,.35)",
      }}
    />
  ));
}

/** Corner block with the white edge stripe carrying the site name, and the date on the right. */
function Header({ date }: { date: Date }) {
  return (
    <div style={{ ...row, height: 96 }}>
      <Para fill="#000" style={{ width: 520, height: "100%", marginLeft: -60, paddingLeft: 116 }}>
        <span style={{ fontSize: 44, fontWeight: 500 }}>phigros</span>
        <span
          style={{
            fontSize: 44,
            fontWeight: 500,
            color: "#8fdcff",
            textShadow: "0 0 15px #8fdcff",
          }}
        >
          .
        </span>
        <span style={{ fontSize: 44, fontWeight: 300, color: DIM }}>tools</span>
      </Para>
      <Para fill="#fff" style={{ width: 11, height: "100%", marginLeft: 10 }} />
      <span style={{ marginLeft: "auto", marginRight: 64, fontSize: 26, color: DIM }}>
        {date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}
      </span>
    </div>
  );
}

/** Profile ribbon: avatar tile cut on the same slant, like the in-game profile, then the name. */
function Ribbon({ name, avatar, width = 740 }: { name: string; avatar?: string; width?: number }) {
  const slant = (RIBBON * TAN) / 2; // how far the top and bottom edges sit off the centre line
  return (
    <Para fill="#000" style={{ width, height: RIBBON }}>
      {avatar && (
        <img
          src={avatar}
          alt=""
          width={132 + 2 * slant}
          height={RIBBON}
          style={{
            marginLeft: -slant,
            objectFit: "cover",
            clipPath: `polygon(${2 * slant}px 0, ${132 + 2 * slant}px 0, 132px 100%, 0 100%)`, // satori has no calc()
          }}
        />
      )}
      <span
        style={{
          ...ellipsis,
          maxWidth: width - (avatar ? 220 : 140),
          marginLeft: avatar ? 19 : 64,
          fontSize: 56,
        }}
      >
        {name || DEFAULT_NAME}
      </span>
    </Para>
  );
}

function Score({ value }: { value: number }) {
  return (
    <Para fill="rgba(8,4,12,.55)" style={{ width: 730, height: 176, marginLeft: 12 }}>
      <Para
        fill="#fff"
        style={{ width: 170, height: "100%", marginLeft: 24, justifyContent: "center" }}
      >
        <span style={{ color: "#000", fontSize: 52, fontWeight: 500 }}>RKS</span>
      </Para>
      <span style={{ marginLeft: 40, fontSize: 150, fontWeight: 300 }}>{value.toFixed(3)}</span>
    </Para>
  );
}

/** Value, small total, label underneath. */
function Stat({ label, value, total }: { label: string; value: number; total?: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
      <div style={baseline}>
        <span style={{ fontSize: 60 }}>{value}</span>
        {total !== undefined && <span style={{ fontSize: 26 }}>/{total}</span>}
      </div>
      <span style={{ fontSize: 22 }}>{label}</span>
    </div>
  );
}

function LevelCount({ level, cleared, total }: { level: string; cleared: number; total: number }) {
  return (
    <div style={row}>
      <Para
        fill={cleared ? "#fff" : "rgba(255,255,255,.45)"}
        style={{ width: 70, height: 46, justifyContent: "center" }}
      >
        <span style={{ color: "#000", fontSize: 26, fontWeight: 500 }}>{level}</span>
      </Para>
      <div style={{ ...baseline, marginLeft: 14 }}>
        <span style={{ fontSize: 28 }}>{cleared}</span>
        <span style={{ fontSize: 16, color: DIM }}>/{total}</span>
      </div>
    </div>
  );
}

function RankGlyph({ chart }: { chart: ChartMetric }) {
  const rank = rankOf(chart.score, chart.fc);
  const [color, glow] =
    rank === "φ"
      ? ["#f5f25b", "rgba(245,242,91,.9)"]
      : chart.fc
        ? ["#4f8df5", "rgba(79,141,245,.8)"]
        : ["#fff", undefined];
  // satori chokes on `undefined` style values, so only set textShadow when there is one.
  return (
    <span style={{ color, fontWeight: 600, ...(glow && { textShadow: `0 0 11px ${glow}` }) }}>
      {rank}
    </span>
  );
}

/** A Best list row, song-select style: the selected (top) one gets a dark band and a white RKS box. */
function BestRow({ chart, index }: { chart: ChartMetric; index: number }) {
  const selected = index === 0;
  return (
    <Para
      fill={selected ? "rgba(0,0,0,.72)" : "transparent"}
      style={{ height: 62, marginLeft: 10, paddingLeft: 26, paddingRight: 6 }}
    >
      <span style={{ width: 44, fontSize: 18, color: FAINT }}>
        {String(index + 1).padStart(2, "0")}
      </span>
      <span style={{ ...ellipsis, width: 300, fontSize: 28 }}>{chart.title}</span>
      <Para
        fill={LEVEL_COLORS[chart.level]!}
        style={{ width: 54, height: 28, marginLeft: 18, justifyContent: "center" }}
      >
        <span style={{ fontSize: 16, fontWeight: 600 }}>{chart.level}</span>
      </Para>
      <div style={{ ...row, width: 60, marginLeft: 18, justifyContent: "center", fontSize: 34 }}>
        <RankGlyph chart={chart} />
      </div>
      <Para
        fill={selected ? "#fff" : "transparent"}
        style={{ width: 138, height: "100%", marginLeft: "auto", justifyContent: "center" }}
      >
        <span style={{ fontSize: 32, color: selected ? "#000" : "#fff" }}>
          {chart.rks.toFixed(2)}
        </span>
      </Para>
    </Para>
  );
}

function BestCharts({ ranking }: { ranking: RankingResult }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", width: 700, gap: 4 }}>
      <Para
        fill="rgba(6,3,8,.8)"
        style={{ ...baseline, height: 64, paddingLeft: 38, paddingTop: 16 }}
      >
        <span style={{ fontSize: 34 }}>Best Charts</span>
        <span style={{ fontSize: 20, color: "rgba(255,255,255,.66)", marginLeft: 20 }}>
          {ranking.ruleset === "b30" ? "B27 + 3 Phi" : "B19 + 1 Phi"}
        </span>
      </Para>
      <div style={{ height: 16 }} />
      {ranking.best.slice(0, 8).map((chart, index) => (
        <BestRow key={chart.key} chart={chart} index={index} />
      ))}
      {!ranking.best.length && (
        <span style={{ marginLeft: 38, fontSize: 26, color: "rgba(255,255,255,.66)" }}>
          No ranked charts yet
        </span>
      )}
    </div>
  );
}

type CardData = {
  name: string;
  ranking: RankingResult;
  songs: SongRecord[];
  date: Date;
  palette: string[];
  /** Challenge Mode rank as stored in the save (hundreds = colour, rest = level); 0 if never cleared. */
  challenge: number;
  /** The avatar as a PNG/JPEG data URL (resvg can't decode AVIF). */
  avatar?: string;
  /** Jacket data URLs by canonical song id, for the grid formats. */
  covers?: Map<string, string>;
};

const FONT_FAMILY = "Saira, Phi, DejaVu Sans, Noto Sans SC, Noto Sans Armenian";

/** Card background shared by every format: the fog, bokeh, white text. */
function Canvas({
  width,
  height,
  palette,
  children,
}: {
  width: number;
  height: number;
  palette: string[];
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width,
        height,
        color: "#fff",
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        ...fog(palette),
      }}
    >
      {bokeh(width, height)}
      {children}
    </div>
  );
}

const CHALLENGE_FILL: Record<string, string> = {
  Green: "#4fbf5a",
  Blue: "#3a78c0",
  Red: "#c43a33",
  Gold: "#e0b43a",
  Rainbow: "linear-gradient(90deg, #f55, #fb4, #5d5, #4bf, #a6f)",
};

/** One line for the grid formats: ribbon, then RKS, Challenge Mode and the format's own figure. */
function ProfileStrip({
  name,
  avatar,
  ranking,
  challenge,
  extra,
}: {
  name: string;
  avatar?: string;
  ranking: RankingResult;
  challenge: number;
  extra?: [label: string, value: string];
}) {
  const rank = challengeRank(challenge);
  return (
    <div style={{ ...row, marginTop: 40, paddingLeft: 40, gap: 30 }}>
      <Ribbon name={name} avatar={avatar} width={620} />
      <Para fill="rgba(8,4,12,.55)" style={{ height: RIBBON, paddingLeft: 30, paddingRight: 40 }}>
        <span style={{ fontSize: 26, color: DIM, marginRight: 18 }}>RKS</span>
        <span style={{ fontSize: 64, fontWeight: 300 }}>{ranking.rankingScore.toFixed(3)}</span>
      </Para>
      {rank && (
        <Para
          fill={CHALLENGE_FILL[rank.colour] ?? "#fff"}
          style={{ width: 96, height: RIBBON, justifyContent: "center" }}
        >
          <span style={{ fontSize: 48, fontWeight: 600, textShadow: "0 0 8px rgba(0,0,0,.5)" }}>
            {rank.level}
          </span>
        </Para>
      )}
      {extra && (
        <Para fill="rgba(8,4,12,.55)" style={{ height: RIBBON, paddingLeft: 30, paddingRight: 40 }}>
          <span style={{ fontSize: 26, color: DIM, marginRight: 18 }}>{extra[0]}</span>
          <span style={{ fontSize: 64, fontWeight: 300 }}>{extra[1]}</span>
        </Para>
      )}
    </div>
  );
}

const TILE_W = 296;
const COVER_H = 156; // the jackets are 1024×540
const TILE_GAP = 16;
const COLUMNS = 5;

/** A chart as a jacket tile: slot tag and level over the art, then title, score, accuracy, rank and RKS. */
function Tile({ chart, tag, cover }: { chart?: ChartMetric; tag: string; cover?: string }) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        width: TILE_W,
        background: "rgba(6,3,8,.72)",
        ...(chart ? {} : { opacity: 0.4 }),
      }}
    >
      <div style={{ position: "relative", display: "flex", width: TILE_W, height: COVER_H }}>
        {cover && <img src={cover} alt="" width={TILE_W} height={COVER_H} />}
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            padding: "2px 10px",
            fontSize: 20,
            fontWeight: 500,
            background: "rgba(0,0,0,.72)",
          }}
        >
          {tag}
        </span>
        {chart && (
          <Para
            fill={LEVEL_COLORS[chart.level]!}
            style={{
              position: "absolute",
              right: 10,
              bottom: 8,
              height: 30,
              paddingLeft: 12,
              paddingRight: 12,
            }}
          >
            <span style={{ fontSize: 17, fontWeight: 600 }}>
              {chart.level} {chart.constant.toFixed(1)}
            </span>
          </Para>
        )}
      </div>
      <div style={{ display: "flex", flexDirection: "column", padding: "8px 12px 10px" }}>
        <span style={{ ...ellipsis, fontSize: 22 }}>{chart?.title ?? "—"}</span>
        {chart && (
          <div style={{ ...row, marginTop: 2 }}>
            <span style={{ fontSize: 26, fontWeight: 500 }}>
              {String(chart.score).padStart(7, "0")}
            </span>
            <span style={{ marginLeft: 10, fontSize: 26 }}>
              <RankGlyph chart={chart} />
            </span>
            <span style={{ marginLeft: "auto", fontSize: 18, color: DIM }}>
              {chart.accuracy.toFixed(2)}%
            </span>
          </div>
        )}
        {chart && (
          <span style={{ fontSize: 18, color: DIM }}>
            RKS <span style={{ color: "#fff", marginLeft: 6 }}>{chart.rks.toFixed(3)}</span>
          </span>
        )}
      </div>
    </div>
  );
}

function TileGrid({
  slots,
  covers,
}: {
  slots: { chart?: ChartMetric; tag: string }[];
  covers?: Map<string, string>;
}) {
  return (
    <div
      style={{
        display: "flex",
        flexWrap: "wrap",
        gap: TILE_GAP,
        width: COLUMNS * TILE_W + (COLUMNS - 1) * TILE_GAP,
        marginTop: 36,
        marginLeft: 28,
      }}
    >
      {slots.map(({ chart, tag }) => (
        <Tile
          key={tag}
          tag={tag}
          chart={chart}
          cover={chart && covers?.get(canonicalSongId(chart.songId))}
        />
      ))}
    </div>
  );
}

function Disclaimer() {
  return (
    <span style={{ position: "absolute", left: 64, bottom: 30, fontSize: 18, color: FAINT }}>
      Unofficial fan-made tool · Not affiliated with Pigeon Games
    </span>
  );
}

/** Best 27 + 3 Phi as jacket tiles, the Phi slots first like the in-game ranking. */
function B30Card(data: CardData) {
  const { width, height } = CARD_SIZE.b30;
  const { ranking } = data;
  const slots = [
    ...Array.from({ length: SLOTS_PHI(ranking) }, (_, i) => ({
      chart: ranking.phi[i],
      tag: `φ${i + 1}`,
    })),
    ...Array.from({ length: SLOTS_BEST(ranking) }, (_, i) => ({
      chart: ranking.best[i],
      tag: `#${i + 1}`,
    })),
  ];
  return (
    <Canvas width={width} height={height} palette={data.palette}>
      <Header date={data.date} />
      <ProfileStrip
        {...data}
        extra={["Best", ranking.ruleset === "b30" ? "B27 + 3φ" : "B19 + 1φ"]}
      />
      <TileGrid slots={slots} covers={data.covers} />
      <Disclaimer />
    </Canvas>
  );
}

/** The best 30 Full Combo charts, and their average. */
function Fc30Card(data: CardData) {
  const { width, height } = CARD_SIZE.fc30;
  const { charts, average } = fullComboBest(data.ranking);
  const slots = Array.from({ length: 30 }, (_, i) => ({ chart: charts[i], tag: `FC #${i + 1}` }));
  return (
    <Canvas width={width} height={height} palette={data.palette}>
      <Header date={data.date} />
      <ProfileStrip {...data} extra={["FC30", average.toFixed(3)]} />
      <TileGrid slots={slots} covers={data.covers} />
      <Disclaimer />
    </Canvas>
  );
}

const SLOTS_PHI = (ranking: RankingResult) => (ranking.ruleset === "b30" ? 3 : 1);
const SLOTS_BEST = (ranking: RankingResult) => (ranking.ruleset === "b30" ? 27 : 19);

/** The summary card: profile, RKS, totals, per-difficulty clears and the top of the Best list. */
function InfoCard({ name, ranking, songs, date, palette, avatar }: CardData) {
  const counts = countLevels(songs);
  const played = songs.reduce((sum, song) => sum + song.levels.filter(Boolean).length, 0);
  const total = (key: "fc" | "phi") => counts.reduce((sum, count) => sum + count[key], 0);
  return (
    <Canvas width={W} height={H} palette={palette}>
      <Header date={date} />
      <div style={{ display: "flex", marginTop: 54, paddingLeft: 40, gap: 54 }}>
        {/* Each block steps right as it goes down, following the skew. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <Ribbon name={name} avatar={avatar} />
          <Score value={ranking.rankingScore} />
          <Para
            fill="rgba(20,18,26,.78)"
            style={{
              width: 716,
              height: 118,
              marginLeft: 24,
              marginTop: 4,
              paddingLeft: 3,
              paddingRight: 5,
            }}
          >
            <Stat label="Charts Played" value={played} />
            <Stat label="Full Combo" value={total("fc")} total={played} />
            <Stat label="Phi" value={total("phi")} total={played} />
          </Para>
          <div
            style={{
              ...row,
              width: 704,
              marginLeft: 36,
              marginTop: 12,
              justifyContent: "space-between",
            }}
          >
            {LEVELS.map((level, index) => (
              <LevelCount
                key={level}
                level={level}
                cleared={counts[index]!.cleared}
                total={catalogChartTotals[index]!}
              />
            ))}
          </div>
        </div>
        <BestCharts ranking={ranking} />
      </div>
      <Disclaimer />
    </Canvas>
  );
}

const FONT_FILES = [
  ["Saira", 300, "Saira-300.ttf"],
  ["Saira", 400, "Saira-400.ttf"],
  ["Saira", 500, "Saira-500.ttf"],
  ["Saira", 600, "Saira-600.ttf"],
  ["Phi", 600, "DejaVuSans-Bold-phi.ttf"], // just φ, curly like the site's
  // Only the song-title characters Saira lacks (scripts/build-card-fonts.ts): anything else shows as missing.
  ["DejaVu Sans", 400, "DejaVuSans-titles.ttf"],
  ["Noto Sans SC", 400, "NotoSansSC-titles.ttf"],
  ["Noto Sans Armenian", 400, "NotoSansArmenian-titles.ttf"],
] as const;

let ready: Promise<Parameters<typeof satori>[1]["fonts"]> | undefined;
/** Fonts and the two wasm modules, fetched once per page load. */
function load() {
  ready ??= Promise.all([
    initWasm(fetch(resvgWasm)),
    initSatori(fetch(yogaWasm)),
    ...FONT_FILES.map(async ([name, weight, file]) => ({
      name,
      weight,
      style: "normal" as const,
      data: await (await fetch(`/fonts/card/${file}`)).arrayBuffer(),
    })),
  ]).then(([, , ...fonts]) => fonts);
  ready.catch(() => {
    ready = undefined; // let the next attempt retry a failed download
  });
  return ready;
}

/**
 * An image re-encoded as a data URL, since resvg can't decode the AVIF files; scaled to `width` if given.
 * Undefined if it won't load, and the card is drawn without it.
 */
async function decoded(url: string, type: string, width?: number): Promise<string | undefined> {
  const image = new Image();
  image.src = url;
  try {
    await image.decode();
  } catch {
    return undefined;
  }
  const canvas = document.createElement("canvas");
  canvas.width = width ?? image.naturalWidth;
  canvas.height = Math.round((canvas.width / image.naturalWidth) * image.naturalHeight);
  canvas.getContext("2d")!.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL(type, 0.86);
}

/** Jackets for the charts a grid format shows, at twice the tile width so they stay sharp. */
async function coverImages(charts: ChartMetric[]) {
  const ids = [...new Set(charts.map((chart) => canonicalSongId(chart.songId)))];
  const images = await Promise.all(
    ids.map((id) => decoded(`/covers/${id}.avif`, "image/jpeg", TILE_W * 2)),
  );
  return new Map(ids.flatMap((id, i) => (images[i] ? [[id, images[i]] as const] : [])));
}

export const CARDS: Record<CardFormat, (data: CardData) => React.ReactElement> = {
  info: InfoCard,
  b30: B30Card,
  fc30: Fc30Card,
};

export async function renderShareCard(
  format: CardFormat,
  {
    avatar,
    ...data
  }: Omit<CardData, "avatar" | "covers"> & { /** In-game avatar name. */ avatar: string },
): Promise<Blob> {
  const shown =
    format === "b30"
      ? [...data.ranking.phi, ...data.ranking.best]
      : format === "fc30"
        ? fullComboBest(data.ranking).charts
        : [];
  const [fonts, avatarImage, covers] = await Promise.all([
    load(),
    decoded(avatarUrl(avatar), "image/png"),
    coverImages(shown),
  ]);
  const Card = CARDS[format];
  const { width, height } = CARD_SIZE[format];
  const svg = await satori(<Card {...data} avatar={avatarImage} covers={covers} />, {
    width,
    height,
    fonts,
  });
  const png = new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
  return new Blob([new Uint8Array(png)], { type: "image/png" });
}
