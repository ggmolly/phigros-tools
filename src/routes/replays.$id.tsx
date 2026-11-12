import { createFileRoute, Link, notFound, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { catalogSong } from "../catalog";
import { Arrow } from "../components/arrow";
import { ChartPlayer } from "../components/chart-player";
import { SiteHeader } from "../components/chrome";
import { PlayerTag, PlayStatusLabel } from "../components/plays";
import { Rank, score7 } from "../components/primitives";
import { useFormat, useT } from "../i18n";
import { CHALLENGE, judge, type Result, WINDOWS } from "../judge";
import { useLive } from "../live";
import { LEVELS, type LevelName } from "../modules";
import { decodeReplay, type ReplayFrame, type ReplayHeader } from "../pigeon";
import { type Chart, countUpTo, parseChart, type RawChart } from "../player/chart";
import { decodePhc } from "../player/phc";
import type { Play } from "../player/render";
import { CARDS, getReplayInfo } from "../plays";
import { headT, pageMeta, SITE } from "../seo";

// link previews show who played what (server/card.tsx)
export const Route = createFileRoute("/replays/$id")({
  loader: async ({ params }) => {
    const info = await getReplayInfo({ data: params.id });
    if (!info) throw notFound();
    return info;
  },
  head: ({ params, loaderData: info, match }) => {
    const { locale } = headT(match);
    const song = info && catalogSong(info.song);
    if (!info || !song) return {};
    const constant = song.constants[LEVELS.indexOf(info.level as LevelName)] ?? 0;
    const tag = `${info.player.name}#${String(info.player.number).padStart(4, "0")}`;
    return {
      meta: [
        ...pageMeta({
          title: `${tag} · ${song.title} (${info.level})`,
          description: `${song.artist} · ${info.level} ${constant.toFixed(1)} · ${score7(info.score)} · ${info.accuracy.toFixed(2)}%`,
          path: `/replays/${params.id}`,
          locale,
          themeColor: info.themeColor,
          image: {
            url: `${SITE}/og/replay/${params.id}.jpg`,
            ...CARDS.replay,
            alt: `${tag}, ${song.title} (${info.level}), ${score7(info.score)}`,
          },
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
function toPlay(
  raw: RawChart,
  chart: Chart,
  result: Result,
  challenge: boolean,
): Play & { hits: Chart["hits"] } {
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
  // the judgements in the order they came, each with the counts and the max combo up to it
  const KINDS = ["perfect", "good", "bad", "miss"] as const;
  const byTime = [...result.hits].sort((a, b) => a.t - b.t);
  const counts: [number, number, number, number][] = [];
  for (const hit of byTime) {
    const next = [...(counts.at(-1) ?? [0, 0, 0, 0])] as [number, number, number, number];
    next[KINDS.indexOf(hit.judgement)]!++;
    counts.push(next);
  }
  const maxcombo: number[] = [];
  for (const [, combo] of result.timeline) maxcombo.push(Math.max(maxcombo.at(-1) ?? 0, combo));
  const state = (t: number) => {
    const step = countUpTo(result.timeline, t, ([time]) => time) - 1;
    const entry = result.timeline[step];
    return {
      combo: entry?.[1] ?? 0,
      score: entry?.[2] ?? 0,
      maxcombo: maxcombo[step] ?? 0,
      counts: counts[countUpTo(byTime, t, (hit) => hit.t) - 1] ?? [0, 0, 0, 0],
    };
  };
  // drags and flicks are judged on time, they have no timing to show
  const timing: Play["timing"] = [];
  let average = 0;
  for (const hit of [...result.hits].sort((a, b) => (a.hit ?? a.t) - (b.hit ?? b.t))) {
    if (!hit.offset || hit.judgement === "miss") continue;
    average = average * 0.9 + hit.offset * 1000 * 0.1;
    timing.push({ at: hit.hit ?? hit.t, ms: hit.offset * 1000, judgement: hit.judgement, average });
  }
  const windows = (challenge ? CHALLENGE : WINDOWS).map(
    (window) => window * 1000,
  ) as Play["windows"];
  return { judged, state, hits, timing, windows };
}

function ReplayPage() {
  const { id } = Route.useParams();
  const info = Route.useLoaderData();
  const t = useT();
  const format = useFormat();
  const [replay, setReplay] = useState<{ header: ReplayHeader; frames: ReplayFrame[] }>();
  const [chart, setChart] = useState<{ raw: RawChart; parsed: Chart }>();
  const [error, setError] = useState<string>();
  const router = useRouter();
  // its status shows up once the worker judged it
  useLive(info.status === "pending" ? info.player.id : undefined, () => void router.invalidate());

  useEffect(() => {
    setReplay(undefined);
    setChart(undefined);
    setError(undefined);
    const bytes = (url: string) =>
      fetch(url).then((res) =>
        res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`)),
      );
    Promise.all([
      bytes(`/api/replays/${encodeURIComponent(id)}`),
      bytes(`/chart-data/${encodeURIComponent(info.song)}/${info.level}.phc`),
    ])
      .then(([replay, data]) => {
        setReplay(decodeReplay(new Uint8Array(replay), true));
        const raw = decodePhc(new Uint8Array(data));
        setChart({ raw, parsed: parseChart(raw) });
      })
      .catch((reason: Error) => setError(t.player.loadError(reason.message)));
  }, [id, info.song, info.level, t]);

  const song = catalogSong(info.song);
  const level = info.level as LevelName;
  const constant = song?.constants[LEVELS.indexOf(level)] ?? 0;
  const overlay = useMemo(() => replay && drawFingers(replay.header, replay.frames), [replay]);
  // the replay judged like the game did, so the chart is drawn as it was played
  const play = useMemo(
    () =>
      replay &&
      chart &&
      toPlay(
        chart.raw,
        chart.parsed,
        judge(chart.raw, replay.frames, replay.header),
        replay.header.challenge === 1,
      ),
    [replay, chart],
  );

  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        {song && (
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
                <PlayerTag player={info.player} /> · {level} {constant.toFixed(1)} ·{" "}
                {score7(info.score)} · {info.accuracy.toFixed(2)}% · {format.date(info.date)}
              </p>
              <p className="meta">
                <PlayStatusLabel status={info.status} /> · {t.song.playedWith(info.phigrospp)}
                {info.files.length > 0 && ` · ${t.song.addedFiles(info.files.join(", "))}`}
              </p>
            </div>
            <Rank score={info.score} fc={info.fc} />
          </div>
        )}
        {error && <p className="meta">{error}</p>}
        {chart && song ? (
          <ChartPlayer
            key={id}
            chart={chart.parsed}
            background={`/covers/${song.id}.avif`}
            music={`/music/${song.id}.webm`}
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
