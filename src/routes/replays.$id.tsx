import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { catalogSong } from "../catalog";
import { Arrow } from "../components/arrow";
import { ChartPlayer } from "../components/chart-player";
import { SiteHeader } from "../components/chrome";
import { Modifiers, multiplierLabel } from "../components/modifiers";
import { PlayerTag, PlayStatusLabel, SongHeading, Timing } from "../components/plays";
import { Difficulty, Rank, score7 } from "../components/primitives";
import { useFormat, useT } from "../i18n";
import { judge } from "../judge";
import { useLiveReload } from "../live";
import { activeMods, modChart } from "../modifiers";
import { LEVELS, type LevelName } from "../modules";
import { decodeReplay, type ReplayFrame, type ReplayHeader } from "../pigeon";
import { type Chart, parseChart, type RawChart } from "../player/chart";
import { decodePhc } from "../player/phc";
import { CARDS, getReplayInfo } from "../plays";
import { drawFingers, toPlay } from "../replay-play";
import { headT, pageMeta, SITE } from "../seo";
import { topics } from "../topics";

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
    // EZ and HD are also difficulties, so text names the modifiers in full
    const modifiers = info.mods
      ? ` · ${activeMods(info.mods)
          .map(([, , name]) => name)
          .join(", ")} ${multiplierLabel(info.mods)}`
      : "";
    return {
      meta: [
        ...pageMeta({
          title: `${tag} · ${song.title} (${info.level})`,
          description: `${song.artist} · ${info.level} ${constant.toFixed(1)} · ${score7(info.total)} · ${info.accuracy.toFixed(2)}%${modifiers}`,
          path: `/replays/${params.id}`,
          locale,
          themeColor: info.themeColor,
          image: {
            url: `${SITE}/og/replay/${params.id}.jpg`,
            ...CARDS.replay,
            alt: `${tag}, ${song.title} (${info.level}), ${score7(info.total)}`,
          },
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: ReplayPage,
});

function ReplayPage() {
  const { id } = Route.useParams();
  const info = Route.useLoaderData();
  const t = useT();
  const format = useFormat();
  const [replay, setReplay] = useState<{ header: ReplayHeader; frames: ReplayFrame[] }>();
  const [chart, setChart] = useState<{ raw: RawChart; parsed: Chart }>();
  const [error, setError] = useState<string>();
  // its status shows up once the worker judged it
  useLiveReload([info.status === "pending" && topics.player(info.player.id)]);

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
      .then(([file, data]) => {
        const replay = decodeReplay(new Uint8Array(file), true);
        const { mods, seed, mirror } = replay.header;
        // the chart as it was played, for the judge and the picture alike
        const raw = modChart(decodePhc(new Uint8Array(data)), mods, seed, mirror === 1);
        setReplay(replay);
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
        replay.header,
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
            <SongHeading song={song}>
              <p className="meta">
                <PlayerTag player={info.player} /> · <Difficulty level={level} />{" "}
                {constant.toFixed(1)} · {format.date(info.date)}
              </p>
              <p className="meta">
                <PlayStatusLabel status={info.status} /> · {t.song.playedWith(info.phigrospp)}
                {info.files.length > 0 && ` · ${t.song.addedFiles(info.files.join(", "))}`}
              </p>
            </SongHeading>
            <p className="replay-result">
              <span title={info.mods ? score7(info.score) : undefined}>{score7(info.total)}</span>
              {info.mods > 0 && (
                <span className="meta">
                  {multiplierLabel(info.mods)}
                  <Modifiers mods={info.mods} />
                </span>
              )}
              <span className="meta">{info.accuracy.toFixed(2)}%</span>
              {info.timing !== null && (
                <span className="meta">
                  {t.song.timing} <Timing timing={info.timing} />
                </span>
              )}
              <Rank score={info.score} fc={info.fc} />
            </p>
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
