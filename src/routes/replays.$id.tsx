import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { canonicalSongId, catalogSong } from "../catalog";
import { Arrow } from "../components/arrow";
import { ChartPlayer } from "../components/chart-player";
import { SiteHeader } from "../components/chrome";
import { Rank, score7 } from "../components/primitives";
import { useFormat, useT } from "../i18n";
import { judge, type Result } from "../judge";
import { LEVELS, type LevelName } from "../modules";
import { decodeReplay, type ReplayFrame, type ReplayHeader } from "../pigeon";
import { type Chart, countUpTo, parseChart, type RawChart } from "../player/chart";
import { decodePhc } from "../player/phc";
import type { Play } from "../player/render";
import { headT, pageMeta } from "../seo";

export const Route = createFileRoute("/replays/$id")({
  head: ({ params, match }) => {
    const { locale, t } = headT(match);
    return {
      meta: [
        ...pageMeta({
          title: t.song.watch,
          description: t.leaderboard.description,
          path: `/replays/${params.id}`,
          locale,
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: ReplayPage,
});

// the fingers look like the game's taps mod (mod/mods/taps.lua): a diamond on the recorded screen with a dark outline,
// yellow on the frame it lands, and a lifted finger fading out where it ended
const TAP = 110;
const OUTLINE = 14;
const FADE = 0.35; // seconds of song time
const LANDED = "255 217 77";
const HELD = "255 255 255";

/** The index of the last frame at or before song time t (-1 before the first), by halving: frames are in song order. */
function frameIndex(frames: ReplayFrame[], t: number) {
  if (!frames.length || frames[0]!.t > t) return -1;
  let low = 0;
  let high = frames.length - 1;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (frames[middle]!.t <= t) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The fingers at song time t and the ones lifted just before, mapped from the recorded screen (bottom left origin). */
function drawFingers(header: ReplayHeader, frames: ReplayFrame[]) {
  return (ctx: CanvasRenderingContext2D, t: number, W: number, H: number) => {
    const scale = H / header.height;
    const diamond = (x: number, y: number, rgb: string, alpha: number) => {
      ctx.save();
      ctx.translate((x / header.width) * W, (1 - y / header.height) * H);
      ctx.rotate(Math.PI / 4);
      const outer = ((TAP + OUTLINE) / 2) * scale;
      const inner = (TAP / 2) * scale;
      ctx.fillStyle = `rgb(0 0 0 / ${0.55 * alpha})`;
      ctx.fillRect(-outer, -outer, outer * 2, outer * 2);
      ctx.fillStyle = `rgb(${rgb} / ${0.9 * alpha})`;
      ctx.fillRect(-inner, -inner, inner * 2, inner * 2);
      ctx.restore();
    };
    const index = frameIndex(frames, t);
    if (index < 0) return;
    // lifted fingers of the last FADE seconds, oldest first so newer ones draw on top
    let from = index;
    while (from > 0 && frames[from - 1]!.t > t - FADE) from--;
    for (let i = from; i <= index; i++)
      for (const touch of frames[i]!.touches)
        if (touch.phase === 3 || touch.phase === 4)
          diamond(touch.x, touch.y, HELD, 1 - (t - frames[i]!.t) / FADE);
    const frame = frames[index]!;
    if (t - frame.t > 0.1) return;
    for (const touch of frame.touches)
      if (touch.phase !== 3 && touch.phase !== 4)
        diamond(touch.x, touch.y, touch.phase === 0 ? LANDED : HELD, 1);
  };
}

/** The judged play laid on the parsed chart's notes: a line's notes are its notes above, then below. */
function toPlay(raw: RawChart, chart: Chart, result: Result): Play & { hits: Chart["hits"] } {
  const judged: Play["judged"] = new Map();
  const hits: Chart["hits"] = [];
  for (const hit of result.hits) {
    const line = chart.lines[hit.line]!;
    const note =
      line.notes[(hit.below ? raw.judgeLineList[hit.line]!.notesAbove.length : 0) + hit.index]!;
    judged.set(note, { judgement: hit.judgement, hit: hit.hit, end: hit.t });
    if (hit.hit !== undefined && hit.judgement !== "bad" && hit.judgement !== "miss")
      hits.push({ sec: hit.hit, type: note.type });
  }
  hits.sort((a, b) => a.sec - b.sec);
  const state = (t: number) => {
    const entry = result.timeline[countUpTo(result.timeline, t, ([time]) => time) - 1];
    return { combo: entry?.[1] ?? 0, score: entry?.[2] ?? 0 };
  };
  return { judged, state, hits };
}

function ReplayPage() {
  const { id } = Route.useParams();
  const t = useT();
  const format = useFormat();
  const [replay, setReplay] = useState<{ header: ReplayHeader; frames: ReplayFrame[] }>();
  const [chart, setChart] = useState<{ raw: RawChart; parsed: Chart }>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setReplay(undefined);
    setChart(undefined);
    setError(undefined);
    fetch(`/api/replays/${encodeURIComponent(id)}`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((bytes) => {
        const decoded = decodeReplay(new Uint8Array(bytes), true);
        setReplay(decoded);
        const song = canonicalSongId(decoded.header.id.replace(/\.0$/, ""));
        return fetch(`/chart-data/${encodeURIComponent(song)}/${decoded.header.difficulty}.phc`);
      })
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => {
        const raw = decodePhc(new Uint8Array(data));
        setChart({ raw, parsed: parseChart(raw) });
      })
      .catch((reason: Error) => setError(t.player.loadError(reason.message)));
  }, [id, t]);

  const header = replay?.header;
  const songId = header && canonicalSongId(header.id.replace(/\.0$/, ""));
  const song = songId ? catalogSong(songId) : undefined;
  const level = header?.difficulty as LevelName | undefined;
  const constant = song && level ? (song.constants[LEVELS.indexOf(level)] ?? 0) : 0;
  const overlay = useMemo(() => replay && drawFingers(replay.header, replay.frames), [replay]);
  // the replay judged like the game did, so the chart is drawn as it was played
  const play = useMemo(
    () =>
      replay &&
      chart &&
      toPlay(chart.raw, chart.parsed, judge(chart.raw, replay.frames, replay.header)),
    [replay, chart],
  );

  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        {header && song && level && (
          <div className="chart-player-bar">
            <Link
              to="/charts/$id/plays/$level"
              params={{ id: song.id, level }}
              className="btn btn-ghost"
            >
              <span className="chart-player-back">
                <Arrow />
              </span>
              {t.tabs.leaderboard}
            </Link>
            <div className="chart-player-heading">
              <h1 className="panel-title">{song.title}</h1>
              <p className="meta">
                {level} {constant.toFixed(1)} · {score7(header.score)} ·{" "}
                {header.accuracy.toFixed(2)}% · {format.date(header.date * 1000)}
              </p>
            </div>
            <Rank score={header.score} fc={header.bad + header.miss === 0} />
          </div>
        )}
        {error && <p className="meta">{error}</p>}
        {chart && song && level ? (
          <ChartPlayer
            key={id}
            chart={chart.parsed}
            background={`/covers/${song.id}.avif`}
            title={song.title}
            level={`${level}  Lv.${Math.floor(constant)}`}
            overlay={overlay}
            play={play}
          />
        ) : (
          !error && <p className="meta">{t.player.loading}</p>
        )}
      </main>
    </>
  );
}
