import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as v from "valibot";
import { catalogSong } from "../catalog";
import { getSongDetails } from "../chartStats";
import { Arrow } from "../components/arrow";
import { ChartPlayer } from "../components/chart-player";
import { SiteHeader } from "../components/chrome";
import { Difficulty } from "../components/primitives";
import { LEVELS, type LevelName } from "../modules";
import { type Chart, parseChart } from "../player/chart";
import { decodePhc } from "../player/phc";
import { pageMeta, SITE } from "../seo";

const songLevels = (id: string) =>
  LEVELS.filter((_, index) => catalogSong(id)?.constants[index] != null);

const isLevel = (level: string): level is LevelName => LEVELS.includes(level as LevelName);

const PlaySearch = v.object({
  t: v.fallback(
    v.optional(
      v.pipe(v.unknown(), v.transform(Number), v.finite(), v.minValue(1), v.transform(Math.floor)),
    ),
    undefined,
  ),
});

export const Route = createFileRoute("/charts/$id_/play/$level")({
  validateSearch: PlaySearch,
  loader: ({ params }) => {
    if (!isLevel(params.level) || !songLevels(params.id).includes(params.level)) throw notFound();
    return getSongDetails({ data: params.id });
  },
  // Link previews like the song page's: the cover card and its accent colour, plus this chart's size and tempo.
  head: ({ params, loaderData, match }) => {
    const song = catalogSong(params.id);
    const path = `/charts/${encodeURIComponent(params.id)}/play/${params.level}`;
    if (!song)
      return {
        meta: [
          ...pageMeta({
            title: "Chart Preview",
            description: "Watch a Phigros chart play out.",
            path,
          }),
          { name: "robots", content: "noindex" },
        ],
      };
    const stats = loaderData?.stats?.[LEVELS.indexOf(params.level as LevelName)];
    const bpm =
      stats && (stats.bpmMin === stats.bpmMax ? `${stats.bpm}` : `${stats.bpmMin}–${stats.bpmMax}`);
    return {
      meta: [
        ...pageMeta({
          title: `${song.title} (${params.level}) Chart Preview`,
          description: [
            `Watch the ${params.level} chart of ${song.title} by ${song.artist} play out.`,
            stats && `${stats.notes.toLocaleString("en")} notes at ${bpm} BPM.`,
          ]
            .filter(Boolean)
            .join(" "),
          path,
          themeColor: loaderData?.themeColor,
          image: {
            url: `${SITE}/og/chart/${encodeURIComponent(song.id)}/${params.level}.jpg${match.search.t ? `?t=${match.search.t}` : ""}`,
            width: 1200,
            height: 630,
            alt: `${song.title} (${params.level} ${song.constants[LEVELS.indexOf(params.level as LevelName)]?.toFixed(1)}) by ${song.artist}${stats ? `: ${stats.notes} notes at ${bpm} BPM` : ""}`,
          },
        }),
        { name: "robots", content: "noindex" },
      ],
      links: [{ rel: "canonical", href: `${SITE}${path}` }],
    };
  },
  component: PlayPage,
});

function PlayPage() {
  const params = Route.useParams();
  const { t } = Route.useSearch();
  const song = catalogSong(params.id)!; // the loader 404s unknown songs and levels
  const levels = songLevels(song.id);
  const level = params.level as LevelName;

  const [chart, setChart] = useState<Chart>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    setError(undefined);
    fetch(`/chart-data/${encodeURIComponent(song.id)}/${level}.phc`)
      .then((res) => (res.ok ? res.arrayBuffer() : Promise.reject(new Error(`HTTP ${res.status}`))))
      .then((data) => setChart(parseChart(decodePhc(new Uint8Array(data)))))
      .catch((reason: Error) => setError(`Couldn't load the chart: ${reason.message}`));
  }, [song.id, level]);

  // Let's cut off the decimal like Phigros do (i think?)
  const constant = song.constants[LEVELS.indexOf(level)] ?? 0;
  const charter = song.charters[LEVELS.indexOf(level)]?.trim();
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <div className="chart-player-bar">
          <Link to="/charts/$id" params={{ id: song.id }} className="btn btn-ghost">
            <span className="chart-player-back">
              <Arrow />
            </span>
            Back to Chart
          </Link>
          <div className="chart-player-heading">
            <h1 className="panel-title">{song.title}</h1>
            <p className="meta">
              {song.artist} · {level} {constant.toFixed(1)}
              {charter && ` · Charted by ${charter}`}
            </p>
          </div>
          <span className="chart-player-levels">
            {levels.map((name) => (
              <Link
                key={name}
                to="/charts/$id/play/$level"
                params={{ id: song.id, level: name }}
                aria-current={name === level ? "page" : undefined}
              >
                <Difficulty level={name} />
              </Link>
            ))}
          </span>
        </div>
        {error && <p className="meta">{error}</p>}
        {chart ? (
          <ChartPlayer
            key={song.id}
            chart={chart}
            background={`/covers/${song.id}.avif`}
            title={song.title}
            level={`${level}  Lv.${Math.floor(constant)}`}
            startAt={t}
          />
        ) : (
          !error && <p className="meta">Loading…</p>
        )}
      </main>
    </>
  );
}
