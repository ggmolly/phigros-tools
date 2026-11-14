import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as v from "valibot";
import { catalogSong, isLevel, songLevels } from "../catalog";
import { getSongDetails } from "../chartStats";
import { Arrow } from "../components/arrow";
import { ChartPlayer } from "../components/chart-player";
import { SiteHeader } from "../components/chrome";
import { SongHeading } from "../components/plays";
import { Difficulty } from "../components/primitives";
import { useT } from "../i18n";
import { LEVELS, type LevelName } from "../modules";
import { type Chart, parseChart } from "../player/chart";
import { decodePhc } from "../player/phc";
import { headT, pageLinks, pageMeta, SITE } from "../seo";

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
    const { locale, t } = headT(match);
    const song = catalogSong(params.id);
    const path = `/charts/${encodeURIComponent(params.id)}/play/${params.level}`;
    if (!song)
      return {
        meta: [
          ...pageMeta({
            title: t.seo.playFallbackTitle,
            description: t.seo.playFallbackDescription,
            path,
            locale,
          }),
          { name: "robots", content: "noindex" },
        ],
      };
    const stats = loaderData?.stats?.[LEVELS.indexOf(params.level as LevelName)];
    const time = match.search.t;
    const at = time
      ? t.seo.playAt(`${Math.floor(time / 60)}:${String(time % 60).padStart(2, "0")}`)
      : "";
    const bpm =
      stats && (stats.bpmMin === stats.bpmMax ? `${stats.bpm}` : `${stats.bpmMin}–${stats.bpmMax}`);
    return {
      meta: [
        ...pageMeta({
          title: `${t.seo.playTitle(song.title, params.level)}${at}`,
          description: [
            t.seo.playDescription(params.level, song.title, song.artist, at),
            stats && t.seo.playStats(stats.notes.toLocaleString(locale), bpm!),
          ]
            .filter(Boolean)
            .join(" "),
          path,
          locale,
          themeColor: loaderData?.themeColor,
          image: {
            url: `${SITE}/og/chart/${encodeURIComponent(song.id)}/${params.level}.jpg${time ? `?t=${time}` : ""}`,
            width: 1200,
            height: 630,
            alt: [
              `${song.title} (${params.level} ${song.constants[LEVELS.indexOf(params.level as LevelName)]?.toFixed(1)}) · ${song.artist}`,
              stats && t.seo.playStats(stats.notes.toLocaleString(locale), bpm!),
            ]
              .filter(Boolean)
              .join(" · "),
          },
        }),
        { name: "robots", content: "noindex" },
      ],
      links: pageLinks(path, locale),
    };
  },
  component: PlayPage,
});

function PlayPage() {
  const params = Route.useParams();
  const { t: startAt } = Route.useSearch();
  const t = useT();
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
      .catch((reason: Error) => setError(t.player.loadError(reason.message)));
  }, [song.id, level, t]);

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
            {t.player.back}
          </Link>
          <SongHeading song={song}>
            <p className="meta">
              {song.artist} · {level} {constant.toFixed(1)}
              {charter && ` · ${t.player.chartedBy(charter)}`}
            </p>
          </SongHeading>
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
            music={`/music/${song.id}.webm`}
            title={song.title}
            level={`${level}  Lv.${Math.floor(constant)}`}
            startAt={startAt}
          />
        ) : (
          !error && <p className="meta">{t.player.loading}</p>
        )}
      </main>
    </>
  );
}
