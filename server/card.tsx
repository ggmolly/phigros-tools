// satori calls these components as plain functions, outside React, so the React Compiler must not add hooks to them.
"use no memo";

// satori stays at 0.32.0: 0.63 drops most of these cards' text and shifts their layout
import satori from "satori";
import sharp, { type Sharp } from "sharp";
import { catalogChartTotals, catalogSong } from "../src/catalog";
import { avatarUrl, rankOf, score7 } from "../src/components/primitives";
import { type ChartMetric, calculateRanking, type RankingResult } from "../src/metrics";
import { countLevels, LEVELS, type SongRecord } from "../src/modules";
import { DEFAULT_PALETTE, FOG_LAYOUT } from "../src/palettes";
import { CARDS, type PlayerName, type PlayerProfile, type ReplayInfo } from "../src/plays";
import { songPalette } from "../src/song-palettes";

const { width: W, height: H } = CARDS.player;

/*
 * The link preview images of players and replays as JSX, laid out by satori (flexbox, like the page) into an SVG and rasterised by sharp. It's in
 * English whatever the page's language.
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
        {date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
      </span>
    </div>
  );
}

/** Profile ribbon: avatar tile cut on the same slant, like the in-game profile, then the name#0042. */
function Ribbon({
  player,
  avatar,
  width = 740,
  size = 56,
}: {
  player: PlayerName;
  avatar?: string;
  width?: number;
  /** the name's font size */
  size?: number;
}) {
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
      <div
        style={{
          ...baseline,
          maxWidth: width - (avatar ? 220 : 140),
          marginLeft: avatar ? 19 : 64,
        }}
      >
        <span style={{ ...ellipsis, fontSize: size }}>{player.name}</span>
        <span style={{ fontSize: 30, color: FAINT }}>
          #{String(player.number).padStart(4, "0")}
        </span>
      </div>
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

function RankGlyph({ score, fc }: { score: number; fc: boolean }) {
  const rank = rankOf(score, fc);
  const [color, glow] =
    rank === "φ"
      ? ["#f5f25b", "rgba(245,242,91,.9)"]
      : fc
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
        <RankGlyph score={chart.score} fc={chart.fc} />
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
  player: PlayerName;
  ranking: RankingResult;
  songs: Pick<SongRecord, "fc" | "levels">[];
  date: Date;
  palette: string[];
  /** The avatar as a PNG data URL (satori can't decode AVIF). */
  avatar?: string;
};

const FONT_FAMILY = "Saira, Phi, DejaVu Sans, Noto Sans SC, Noto Sans Armenian";

function Disclaimer() {
  return (
    <span style={{ position: "absolute", left: 64, bottom: 30, fontSize: 18, color: FAINT }}>
      Unofficial fan-made tool · Not affiliated with Pigeon Games
    </span>
  );
}

/** The summary card: profile, RKS, totals, per-difficulty clears and the top of the Best list. */
function InfoCard({ player, ranking, songs, date, palette, avatar }: CardData) {
  const counts = countLevels(songs);
  const played = songs.reduce((sum, song) => sum + song.levels.filter(Boolean).length, 0);
  const total = (key: "fc" | "phi") => counts.reduce((sum, count) => sum + count[key], 0);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: W,
        height: H,
        color: "#fff",
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        ...fog(palette),
      }}
    >
      {bokeh(W, H)}
      <Header date={date} />
      <div style={{ display: "flex", marginTop: 54, paddingLeft: 40, gap: 54 }}>
        {/* Each block steps right as it goes down, following the skew. */}
        <div style={{ display: "flex", flexDirection: "column", gap: 28 }}>
          <Ribbon player={player} avatar={avatar} />
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
    </div>
  );
}

const RW = CARDS.replay.width;
const RH = CARDS.replay.height;
const COVER_W = 440;
const COVER_H = Math.round((COVER_W * 540) / 1024);

/**
 * A replay's card: the player, score, rank, accuracy and judgements, beside the song's cover over its blur. No artist,
 * the card's fonts only hold the song titles' characters.
 */
function ReplayCard({
  info,
  avatar,
  backdrop,
  cover,
}: {
  info: ReplayInfo;
  avatar?: string;
  backdrop?: string;
  cover?: string;
}) {
  const song = catalogSong(info.song)!;
  const constant = song.constants[LEVELS.indexOf(info.level as (typeof LEVELS)[number])] ?? 0;
  const slant = COVER_H * TAN;
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        width: RW,
        height: RH,
        color: "#fff",
        fontFamily: FONT_FAMILY,
        fontWeight: 400,
        background: "#14121a",
      }}
    >
      {backdrop && (
        <img src={backdrop} alt="" width={RW} height={RH} style={{ position: "absolute" }} />
      )}
      <Header date={new Date(info.date)} />
      <div style={{ display: "flex", marginTop: 32, paddingLeft: 40, gap: 36 }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18, width: 644 }}>
          <Ribbon player={info.player} avatar={avatar} width={630} size={48} />
          <Para
            fill="rgba(8,4,12,.6)"
            style={{ ...baseline, width: 630, height: 132, marginLeft: 8, paddingLeft: 36 }}
          >
            <span style={{ fontSize: 108, fontWeight: 300, marginTop: 12 }}>
              {score7(info.score)}
            </span>
            <span style={{ fontSize: 84, marginLeft: 26 }}>
              <RankGlyph score={info.score} fc={info.fc} />
            </span>
          </Para>
          <div style={{ ...baseline, marginLeft: 44, gap: 28 }}>
            <span style={{ fontSize: 40 }}>{info.accuracy.toFixed(2)}%</span>
            <span style={{ fontSize: 24, color: DIM }}>Max Combo {info.maxcombo}</span>
          </div>
          <Para
            fill="rgba(20,18,26,.8)"
            style={{ width: 620, height: 96, marginLeft: 16, paddingLeft: 12, paddingRight: 12 }}
          >
            <Stat label="Perfect" value={info.perfect} />
            <Stat label="Good" value={info.good} />
            <Stat label="Bad" value={info.bad} />
            <Stat label="Miss" value={info.miss} />
          </Para>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: COVER_W, marginTop: 8 }}>
          {cover && (
            <img
              src={cover}
              alt=""
              width={COVER_W}
              height={COVER_H}
              style={{
                clipPath: `polygon(${slant}px 0, ${COVER_W}px 0, ${COVER_W - slant}px 100%, 0 100%)`,
              }}
            />
          )}
          <span style={{ ...ellipsis, marginTop: 24, fontSize: 38, fontWeight: 500 }}>
            {song.title}
          </span>
          <div style={{ ...row, marginTop: 18, gap: 18 }}>
            <Para
              fill={LEVEL_COLORS[info.level]!}
              style={{ height: 40, paddingLeft: 22, paddingRight: 22 }}
            >
              <span style={{ fontSize: 24, fontWeight: 600 }}>
                {info.level} {constant.toFixed(1)}
              </span>
            </Para>
            {info.status === "verified" && (
              <Para fill="#fff" style={{ height: 40, paddingLeft: 22, paddingRight: 22 }}>
                <span style={{ fontSize: 22, fontWeight: 500, color: "#000" }}>Verified</span>
              </Para>
            )}
          </div>
        </div>
      </div>
      <Disclaimer />
    </div>
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

let fonts: Promise<Parameters<typeof satori>[1]["fonts"]> | undefined;

/** A public image as a PNG data URL, edited on the way (resized, blurred), undefined if there's none. */
async function png(origin: string, path: string, edit = (image: Sharp) => image) {
  const response = await fetch(origin + path);
  if (!response.ok) return undefined;
  const data = await edit(sharp(Buffer.from(await response.arrayBuffer())))
    .png()
    .toBuffer();
  return `data:image/png;base64,${data.toString("base64")}`;
}

/** A card as a JPEG, its fonts read from `origin`. */
async function render(
  origin: string,
  card: React.ReactElement,
  size: { width: number; height: number },
) {
  fonts ??= Promise.all(
    FONT_FILES.map(async ([name, weight, file]) => ({
      name,
      weight,
      style: "normal" as const,
      data: await (await fetch(`${origin}/fonts/card/${file}`)).arrayBuffer(),
    })),
  );
  const svg = await satori(card, { ...size, fonts: await fonts });
  return sharp(Buffer.from(svg)).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}

/** A player's card as a JPEG, the site's own files (fonts, avatars) read from `origin`. */
export async function renderPlayerCard(origin: string, profile: PlayerProfile) {
  const songs = new Map<string, CardData["songs"][number] & { songId: string }>();
  for (const play of profile.top) {
    const song = songs.get(play.song) ?? {
      songId: play.song,
      fc: 0,
      levels: [null, null, null, null],
    };
    const index = LEVELS.indexOf(play.level as (typeof LEVELS)[number]);
    song.levels[index] = play;
    if (play.fc) song.fc |= 1 << index;
    songs.set(play.song, song);
  }
  const ranking = calculateRanking({ songs: [...songs.values()] }, "b30");
  const card = (
    <InfoCard
      player={profile.player}
      ranking={ranking}
      songs={[...songs.values()]}
      date={new Date()}
      palette={
        songPalette(profile.background) ??
        (ranking.best[0] && songPalette(ranking.best[0].songId)) ??
        DEFAULT_PALETTE
      }
      avatar={await png(origin, avatarUrl(profile.player.avatar))}
    />
  );
  return render(origin, card, CARDS.player);
}

/** A replay's card as a JPEG, the site's own files (fonts, avatars, covers) read from `origin`. */
export async function renderReplayCard(origin: string, info: ReplayInfo) {
  const cover = `/covers/${encodeURIComponent(info.song)}.avif`;
  const card = (
    <ReplayCard
      info={info}
      avatar={await png(origin, avatarUrl(info.player.avatar))}
      backdrop={
        await png(origin, cover, (image) =>
          image.resize(RW, RH).blur(24).modulate({ brightness: 0.45 }),
        )
      }
      cover={await png(origin, cover, (image) => image.resize(COVER_W * 2))}
    />
  );
  return render(origin, card, CARDS.replay);
}
