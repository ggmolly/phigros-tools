// satori calls these components as plain functions, outside React, so the React Compiler must not add hooks to them.
"use no memo";

// satori stays at 0.32.0: 0.63 drops most of these cards' text and shifts their layout
import satori from "satori";
import sharp, { type Sharp } from "sharp";
import { catalogChartTotals, catalogSong } from "../src/catalog";
import { MOD_COLORS, MOD_PATHS, multiplierLabel } from "../src/components/modifiers";
import { avatarUrl, rankOf, score7 } from "../src/components/primitives";
import { type ChartMetric, calculateRanking, type RankingResult } from "../src/metrics";
import { activeMods } from "../src/modifiers";
import type { Mod } from "../src/mods";
import { countLevels, LEVEL_COLORS, LEVELS, type SongRecord } from "../src/modules";
import { DEFAULT_PALETTE, FOG_LAYOUT } from "../src/palettes";
import {
  CARDS,
  type ChartPlays,
  type Play,
  type PlayerName,
  type PlayerProfile,
  type ReplayInfo,
} from "../src/plays";
import { releaseTag } from "../src/release";
import type { Release } from "../src/releases";
import type { RoomPage } from "../src/rooms";
import { songPalette } from "../src/song-palettes";

const { width: W, height: H } = CARDS.player;

/*
 * The link preview images of players, replays and chart rankings as JSX, laid out by satori (flexbox, like the page) into an SVG and rasterised by sharp. It's in
 * English whatever the page's language.
 */

const TAN = 0.25; // same slope as --skew in style.css
const SKEW = `skewX(${(-Math.atan(TAN) * 180) / Math.PI}deg)`;
const DIM = "rgba(255,255,255,.7)";
const FAINT = "rgba(255,255,255,.45)";
const RIBBON = 104; // profile ribbon height; the avatar tile is cut to it

type Style = React.CSSProperties;

/**
 * A block with a parallelogram behind its content, skewed around its centre like `skewX(var(--skew))`. The shape
 * is its own layer so the content stays upright. Lay it out like any flex item.
 */
function Para({
  fill,
  edge,
  style,
  children,
}: {
  fill: string;
  /** The colour of a line along the top. */
  edge?: string;
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
          ...(edge && { borderTop: `3px solid ${edge}` }),
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

/** Corner block with the white edge stripe carrying the site name, and on the right the date over when the card was made. */
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
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "flex-end",
          gap: 4,
          marginLeft: "auto",
          marginRight: 64,
        }}
      >
        <span style={{ fontSize: 26, color: DIM }}>
          {date.toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" })}
        </span>
        {/* chat apps keep a preview for long, this tells how old the one shown is */}
        <span style={{ fontSize: 16, color: FAINT }}>
          Last updated at{" "}
          {new Date().toLocaleString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hourCycle: "h23",
            timeZone: "UTC",
          })}{" "}
          UTC
        </span>
      </div>
    </div>
  );
}

const tag = (player: PlayerName) => `#${String(player.number).padStart(4, "0")}`;

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
        <span style={{ fontSize: 30, color: FAINT }}>{tag(player)}</span>
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
function Stat({
  label,
  value,
  total,
  small,
}: {
  label: string;
  value: number;
  total?: number;
  small?: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: 1 }}>
      <div style={baseline}>
        <span style={{ fontSize: small ? 34 : 60 }}>{value}</span>
        {total !== undefined && <span style={{ fontSize: 26 }}>/{total}</span>}
      </div>
      <span style={{ fontSize: small ? 18 : 22, ...(small && { color: DIM }) }}>{label}</span>
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
 * The frame of a chart's cards: `children` on the left, beside the song's cover over its blur, its title and its
 * level. No artist, the card's fonts only hold the song titles' characters.
 */
function SongCard({
  song: id,
  level,
  date,
  backdrop,
  cover,
  note,
  children,
}: {
  song: string;
  level: string;
  date: Date;
  backdrop?: string;
  cover?: string;
  /** Said next to the level. */
  note?: string;
  children: React.ReactNode;
}) {
  const song = catalogSong(id)!;
  const constant = song.constants[LEVELS.indexOf(level as (typeof LEVELS)[number])] ?? 0;
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
      <Header date={date} />
      <div style={{ display: "flex", marginTop: 32, paddingLeft: 40, gap: 36 }}>
        {children}
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
          <div style={{ ...row, marginTop: 18, gap: 20 }}>
            <Para
              fill={LEVEL_COLORS[level]!}
              style={{ height: 40, paddingLeft: 22, paddingRight: 22 }}
            >
              <span style={{ fontSize: 24, fontWeight: 600 }}>
                {level} {constant.toFixed(1)}
              </span>
            </Para>
            {note && <span style={{ fontSize: 24, color: DIM }}>{note}</span>}
          </div>
        </div>
      </div>
      <Disclaimer />
    </div>
  );
}

// the left side of a `SongCard`
const column: Style = { display: "flex", flexDirection: "column", gap: 18, width: 644 };

/** A replay's card: the player, score, rank, accuracy and judgements. */
function ReplayCard({ info, avatar }: { info: ReplayInfo; avatar?: string }) {
  return (
    <div style={column}>
      <Ribbon player={info.player} avatar={avatar} width={630} size={48} />
      <Para
        fill="rgba(8,4,12,.6)"
        style={{ ...baseline, width: 630, height: 92, marginLeft: 8, paddingLeft: 36 }}
      >
        <span style={{ fontSize: 64, fontWeight: 300, marginTop: 8 }}>{score7(info.total)}</span>
        <span style={{ fontSize: 52, marginLeft: 20 }}>
          <RankGlyph score={info.score} fc={info.fc} />
        </span>
      </Para>
      <div style={{ ...baseline, marginLeft: 40, gap: 22 }}>
        <span style={{ fontSize: 30 }}>{info.accuracy.toFixed(2)}%</span>
        <span style={{ fontSize: 20, color: DIM }}>Max Combo {info.maxcombo}</span>
        {info.mods > 0 && (
          <div style={{ display: "flex", alignItems: "center", alignSelf: "center", gap: 6 }}>
            {activeMods(info.mods).map(([, id, , , kind]) => (
              <div
                key={id}
                style={{
                  display: "flex",
                  padding: 4,
                  borderRadius: 5,
                  background: MOD_COLORS[kind],
                }}
              >
                <Icon d={MOD_PATHS[id]} size={26} colour="#06202b" />
              </div>
            ))}
            <span style={{ fontSize: 20, color: DIM, marginLeft: 6 }}>
              {multiplierLabel(info.mods)}
            </span>
          </div>
        )}
      </div>
      <Para
        fill="rgba(20,18,26,.8)"
        style={{ width: 620, height: 80, marginLeft: 2, paddingLeft: 12, paddingRight: 12 }}
      >
        <Stat small label="Perfect" value={info.perfect} />
        <Stat small label="Good" value={info.good} />
        <Stat small label="Bad" value={info.bad} />
        <Stat small label="Miss" value={info.miss} />
      </Para>
    </div>
  );
}

// the podium's steps left to right: the place they hold, their height and the colour of `.podium` in leaderboard.css
const PODIUM = [
  [1, 190, "#d3dbe6"],
  [0, 220, "#f5f25b"],
  [2, 168, "#e2a877"],
] as const;
const OTHERS = 5; // places listed under the podium

type Ranked = Pick<Play, "rank" | "player" | "accuracy" | "score" | "total" | "fc">;
// a list on the left side of a `SongCard`
const list: Style = {
  flexDirection: "column",
  alignItems: "stretch",
  width: 618,
  marginLeft: 4,
  padding: "8px 30px",
};

/** Places of a ranking as rows `height` high: the place (the first three in the podium's colours), who, and what they got. */
function PlayRows({ plays, height }: { plays: Ranked[]; height: number }) {
  return (
    <Para fill="rgba(20,18,26,.8)" style={list}>
      {plays.map((play) => (
        <div key={play.rank} style={{ ...row, height, fontSize: 22 }}>
          <span
            style={{
              width: 44,
              fontSize: 17,
              color: PODIUM.find(([place]) => place === play.rank - 1)?.[2] ?? FAINT,
            }}
          >
            {String(play.rank).padStart(2, "0")}
          </span>
          <div style={{ ...baseline, flex: 1 }}>
            <span style={{ ...ellipsis, maxWidth: 250 }}>{play.player.name}</span>
            <span style={{ fontSize: 15, color: FAINT }}>{tag(play.player)}</span>
          </div>
          <span style={{ width: 84, fontSize: 18, color: DIM }}>{play.accuracy.toFixed(2)}%</span>
          <span style={{ width: 112, fontWeight: 300 }}>{score7(play.total)}</span>
          <div style={{ ...row, width: 24, justifyContent: "center" }}>
            <RankGlyph score={play.score} fc={play.fc} />
          </div>
        </div>
      ))}
    </Para>
  );
}

/** A chart ranking's card: the three best on a podium with their avatars, then the next places as rows. */
function PlaysCard({ plays, avatars }: { plays: Play[]; avatars: (string | undefined)[] }) {
  return (
    <div style={column}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 10, marginLeft: 26 }}>
        {PODIUM.filter(([place]) => plays[place]).map(([place, height, colour]) => {
          const play = plays[place]!;
          const size = place ? 60 : 76;
          return (
            <Para
              key={place}
              fill="linear-gradient(180deg, rgba(40,36,48,.86), rgba(14,12,18,.8))"
              edge={colour}
              style={{
                flexDirection: "column",
                justifyContent: "center",
                width: 198,
                height,
                paddingTop: 14,
                gap: 6,
              }}
            >
              {/* in the slanted corner, like `.podium-place` */}
              <span
                style={{
                  position: "absolute",
                  top: 12,
                  left: (height * TAN) / 2 + 14,
                  color: colour,
                  fontSize: 30,
                  fontWeight: 600,
                  lineHeight: 1,
                }}
              >
                {place + 1}
              </span>
              {avatars[place] && <img src={avatars[place]} alt="" width={size} height={size} />}
              <div style={{ ...baseline, maxWidth: 176 }}>
                <span style={{ ...ellipsis, fontSize: 20 }}>{play.player.name}</span>
                <span style={{ fontSize: 14, color: FAINT }}>{tag(play.player)}</span>
              </div>
              <div style={{ ...baseline, gap: 10, fontSize: 26 }}>
                <span style={{ fontWeight: 300 }}>{score7(play.score)}</span>
                <RankGlyph score={play.score} fc={play.fc} />
              </div>
            </Para>
          );
        })}
      </div>
      {plays.length > PODIUM.length && <PlayRows plays={plays.slice(PODIUM.length)} height={32} />}
      {!plays.length && (
        <span style={{ marginLeft: 44, marginTop: 24, fontSize: 30, color: DIM }}>
          No plays yet
        </span>
      )}
    </div>
  );
}

/**
 * A room's card: its name over the ranking of its latest match, or before any over who's in it. A room with a
 * password only says how many are.
 */
function RoomCard({ page }: { page: RoomPage }) {
  const match = page.matches[0];
  const players = page.open?.players ?? 0;
  return (
    <div style={column}>
      <span style={{ ...ellipsis, marginLeft: 34, fontSize: 46, fontWeight: 500, lineHeight: 1.2 }}>
        {page.name}
      </span>
      {match ? (
        <PlayRows
          plays={match.plays.map((play) => ({ ...play, fc: play.bad + play.miss === 0 }))}
          height={40}
        />
      ) : page.room ? (
        <Para fill="rgba(20,18,26,.8)" style={list}>
          {page.room.players.map(({ player }) => (
            <div key={player.id} style={{ ...baseline, height: 40, fontSize: 24 }}>
              <span style={{ ...ellipsis, maxWidth: 420 }}>{player.name}</span>
              <span style={{ fontSize: 16, color: FAINT }}>{tag(player)}</span>
            </div>
          ))}
        </Para>
      ) : (
        <div style={{ ...row, marginLeft: 28 }}>
          <Chip>{players === 1 ? "1 player" : `${players} players`}</Chip>
        </div>
      )}
    </div>
  );
}

// what the game's Mods tab draws before an author's name and a star count, as lucide draws them
const VERIFIED =
  "M3.85 8.62a4 4 0 0 1 4.78-4.77 4 4 0 0 1 6.74 0 4 4 0 0 1 4.78 4.78 4 4 0 0 1 0 6.74 4 4 0 0 1-4.77 4.78 4 4 0 0 1-6.75 0 4 4 0 0 1-4.78-4.77 4 4 0 0 1 0-6.76Zm12.15.38-5.5 5.5L8 12";

function Icon({ d, size, colour }: { d: string; size: number; colour: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke={colour}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  );
}

/** A picture cut on the game's slant, like a song's cover in its song list. */
function Slanted({ src, width, height }: { src: string; width: number; height: number }) {
  const slant = height * TAN;
  return (
    <img
      src={src}
      alt=""
      width={width}
      height={height}
      style={{
        objectFit: "cover",
        clipPath: `polygon(${slant}px 0, ${width}px 0, ${width - slant}px 100%, 0 100%)`,
      }}
    />
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <Para fill="rgba(8,4,12,.6)" style={{ height: 44, paddingLeft: 24, paddingRight: 24 }}>
      <span style={{ fontSize: 24 }}>{children}</span>
    </Para>
  );
}

const bytes = (size: number) =>
  size < 1e6 ? `${(size / 1e3).toFixed(1)} kB` : `${(size / 1e6).toFixed(1)} MB`;

/** The frame of the mod catalog's cards: the site's header over the fog, or over a picture when there's one. */
function ModFrame({
  date,
  backdrop,
  children,
}: {
  date: Date;
  backdrop?: string;
  children: React.ReactNode;
}) {
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
        ...(backdrop ? { background: "#14121a" } : fog(DEFAULT_PALETTE)),
      }}
    >
      {backdrop ? (
        <img src={backdrop} alt="" width={RW} height={RH} style={{ position: "absolute" }} />
      ) : (
        bokeh(RW, RH)
      )}
      <Header date={date} />
      {children}
      <Disclaimer />
    </div>
  );
}

const POSTER_W = 480;
const POSTER_H = 270;

/**
 * What a mod's card and a release note's show: a title, a line about it and a text, over chips and beside a picture.
 * A title that `wraps` is smaller and takes two lines.
 */
function Lead({
  title,
  wraps,
  about,
  text,
  chips = [],
  date,
  poster,
  backdrop,
}: {
  title: string;
  wraps?: boolean;
  about: React.ReactNode;
  text: string;
  chips?: string[];
  date: Date;
  poster?: string;
  backdrop?: string;
}) {
  // three lines of it at most, ending on a whole word
  const cut = text.length > 150 ? `${text.slice(0, 150).replace(/\s+\S*$/, "")}…` : text;
  return (
    <ModFrame date={date} backdrop={backdrop}>
      <div style={{ display: "flex", marginTop: 48, paddingLeft: 64, paddingRight: 48, gap: 36 }}>
        <div style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0 }}>
          <span
            style={{
              ...(wraps
                ? { display: "block", lineClamp: 2, fontSize: 48 }
                : { ...ellipsis, fontSize: 68 }),
              fontWeight: 500,
              lineHeight: 1.15,
            }}
          >
            {title}
          </span>
          <div style={{ ...row, gap: 10, marginTop: 10, fontSize: 28, color: DIM }}>{about}</div>
          <span
            style={{ marginTop: 26, fontSize: 25, lineHeight: 1.4, color: "rgba(255,255,255,.88)" }}
          >
            {cut}
          </span>
          <div style={{ ...row, gap: 18, marginTop: 30, marginLeft: 6 }}>
            {chips.map((chip) => (
              <Chip key={chip}>{chip}</Chip>
            ))}
          </div>
        </div>
        {poster && (
          <div style={{ display: "flex", marginTop: 12 }}>
            <Slanted src={poster} width={POSTER_W} height={POSTER_H} />
          </div>
        )}
      </div>
    </ModFrame>
  );
}

const SHOWN = 3; // mods on the catalog's card
const THUMB_W = 256;
const THUMB_H = 144;
const THUMB_STEP = THUMB_H + 18;

/** The catalog's card: what it is, beside its first mods down the game's slant like the rows of its lists. */
function ModsCard({ mods, posters }: { mods: Mod[]; posters: (string | undefined)[] }) {
  const shown = mods.slice(0, SHOWN);
  return (
    <ModFrame date={new Date()}>
      <div style={{ display: "flex", flex: 1, paddingLeft: 64, paddingRight: 48 }}>
        <div style={{ display: "flex", flexDirection: "column", width: 470, marginTop: 70 }}>
          <span style={{ fontSize: 112, fontWeight: 300, lineHeight: 1 }}>Mods</span>
          <span style={{ marginTop: 22, fontSize: 28, lineHeight: 1.35, color: DIM }}>
            Made by players for Phigros++, installed from the game's settings.
          </span>
          <div style={{ ...row, marginTop: 30, marginLeft: 6 }}>
            <Chip>{mods.length === 1 ? "1 mod" : `${mods.length} mods`}</Chip>
          </div>
        </div>
        <div
          style={{
            position: "relative",
            display: "flex",
            flex: 1,
            marginTop: (RH - 96 - 60 - shown.length * THUMB_STEP) / 2,
          }}
        >
          {shown.map((mod, index) => (
            <div
              key={mod.repo}
              style={{
                ...row,
                position: "absolute",
                top: index * THUMB_STEP,
                left: 150 - index * THUMB_STEP * TAN,
                gap: 22,
              }}
            >
              {posters[index] ? (
                <Slanted src={posters[index]} width={THUMB_W} height={THUMB_H} />
              ) : (
                <Para
                  fill="rgba(8,4,12,.6)"
                  style={{ width: THUMB_W - THUMB_H * TAN, height: THUMB_H }}
                />
              )}
              <div style={{ display: "flex", flexDirection: "column", width: 250 }}>
                <span style={{ ...ellipsis, fontSize: 32, fontWeight: 500 }}>{mod.name}</span>
                <div style={{ ...row, gap: 8, marginTop: 4 }}>
                  <Icon d={VERIFIED} size={22} colour="#8fdcff" />
                  <span style={{ ...ellipsis, fontSize: 22, color: DIM }}>{mod.author}</span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </ModFrame>
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
    if (play.status === "declared") continue;
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

/** What `SongCard` shows of a song: its cover, and the same blurred behind the card. */
async function coverImages(origin: string, song: string) {
  const cover = `/covers/${encodeURIComponent(song)}.avif`;
  return {
    backdrop: await png(origin, cover, (image) =>
      image.resize(RW, RH).blur(24).modulate({ brightness: 0.45 }),
    ),
    cover: await png(origin, cover, (image) => image.resize(COVER_W * 2)),
  };
}

/** A replay's card as a JPEG, the site's own files (fonts, avatars, covers) read from `origin`. */
export async function renderReplayCard(origin: string, info: ReplayInfo) {
  const card = (
    <SongCard
      song={info.song}
      level={info.level}
      date={new Date(info.date)}
      {...(await coverImages(origin, info.song))}
    >
      <ReplayCard info={info} avatar={await png(origin, avatarUrl(info.player.avatar))} />
    </SongCard>
  );
  return render(origin, card, CARDS.replay);
}

/** A chart ranking's card as a JPEG, from its first plays. */
export async function renderPlaysCard(
  origin: string,
  song: string,
  level: string,
  { count, plays }: ChartPlays,
) {
  const shown = plays.slice(0, PODIUM.length + OTHERS);
  const avatars = await Promise.all(
    shown
      .slice(0, PODIUM.length)
      .map((play) => png(origin, avatarUrl(play.player.avatar), (image) => image.resize(152, 152))),
  );
  const card = (
    <SongCard
      song={song}
      level={level}
      date={new Date()}
      note={count ? `${count} player${count > 1 ? "s" : ""}` : undefined}
      {...(await coverImages(origin, song))}
    >
      <PlaysCard plays={shown} avatars={avatars} />
    </SongCard>
  );
  return render(origin, card, CARDS.replay);
}

/** A room's card as a JPEG: on the chart of its latest match, or the one it's on, over the fog without one. */
export async function renderRoomCard(origin: string, page: RoomPage) {
  const match = page.matches[0];
  const chart = match ?? page.room?.chart;
  const inside = <RoomCard page={page} />;
  const card =
    chart && catalogSong(chart.song) ? (
      <SongCard
        song={chart.song}
        level={chart.level}
        date={new Date(match?.date ?? Date.now())}
        note={
          chart.mods
            ? `${activeMods(chart.mods)
                .map(([, id]) => id)
                .join(" ")} ${multiplierLabel(chart.mods)}`
            : undefined
        }
        {...(await coverImages(origin, chart.song))}
      >
        {inside}
      </SongCard>
    ) : (
      <ModFrame date={new Date()}>
        <div style={{ display: "flex", marginTop: 32, paddingLeft: 40 }}>{inside}</div>
      </ModFrame>
    );
  return render(origin, card, CARDS.replay);
}

// a mod's poster for its cards: where the catalog serves it
const posterOf = (origin: string, mod: Mod, edit: (image: Sharp) => Sharp) =>
  mod.poster ? png(origin, `/catalog/${mod.poster}`, edit) : undefined;

// a picture as the cards show it beside their text, and behind it, blurred
const beside = (image: Sharp) => image.resize(POSTER_W * 2, POSTER_H * 2, { fit: "cover" });
const behind = (image: Sharp) =>
  image.resize(RW, RH, { fit: "cover" }).blur(28).modulate({ brightness: 0.4 });

/** A mod's card as a JPEG: its name, who made it and what it does, beside what its README shows first. */
export async function renderModCard(origin: string, mod: Mod) {
  const card = (
    <Lead
      title={mod.name}
      about={
        <>
          <Icon d={VERIFIED} size={30} colour="#8fdcff" />
          <span>{mod.author}</span>
        </>
      }
      text={mod.description}
      chips={[mod.version, bytes(mod.size)]}
      date={new Date(mod.updated)}
      poster={await posterOf(origin, mod, beside)}
      backdrop={await posterOf(origin, mod, behind)}
    />
  );
  return render(origin, card, CARDS.replay);
}

/** A release note's card as a JPEG: its title, what it's of and how it starts, beside what it shows first. */
export async function renderReleaseCard(origin: string, release: Release) {
  const picture = (edit: (image: Sharp) => Sharp) =>
    release.shown ? png(origin, `/releases/${release.shown.poster}`, edit) : undefined;
  const card = (
    <Lead
      title={release.title}
      wraps
      about={releaseTag(release)}
      text={release.summary}
      date={new Date(release.date)}
      poster={await picture(beside)}
      backdrop={await picture(behind)}
    />
  );
  return render(origin, card, CARDS.replay);
}

/** The mod catalog's card as a JPEG, from its first mods. */
export async function renderModsCard(origin: string, mods: Mod[]) {
  const posters = await Promise.all(
    mods
      .slice(0, SHOWN)
      .map((mod) =>
        posterOf(origin, mod, (image) => image.resize(THUMB_W * 2, THUMB_H * 2, { fit: "cover" })),
      ),
  );
  return render(origin, <ModsCard mods={mods} posters={posters} />, CARDS.replay);
}
