import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { catalogSong, isLevel, songLevels } from "../catalog";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import {
  Pager,
  PlayCells,
  PlayHeadings,
  RankingSearch,
  ScopeSwitch,
  useJson,
} from "../components/plays";
import { Difficulty } from "../components/primitives";
import { useFormat, useT } from "../i18n";
import { LEVELS, type LevelName } from "../modules";
import { type ChartPlays, PLAYS_PAGE } from "../plays";
import { headT, pageLinks, pageMeta } from "../seo";

export const Route = createFileRoute("/charts/$id_/plays/$level")({
  validateSearch: RankingSearch,
  loader: ({ params }) => {
    if (!isLevel(params.level) || !songLevels(params.id).includes(params.level)) throw notFound();
  },
  // the ranking changes all the time, so it stays out of search results
  head: ({ params, match }) => {
    const { locale, t } = headT(match);
    const song = catalogSong(params.id);
    const path = `/charts/${encodeURIComponent(params.id)}/plays/${params.level}`;
    const title = song ? `${song.title} (${params.level}) · ${t.song.plays}` : t.song.plays;
    return {
      meta: [
        ...pageMeta({ title, description: title, path, locale }),
        { name: "robots", content: "noindex" },
      ],
      links: pageLinks(path, locale),
    };
  },
  component: PlaysPage,
});

function PlaysPage() {
  const params = Route.useParams();
  const { page = 1, verified = false } = Route.useSearch();
  const t = useT();
  const format = useFormat();
  const song = catalogSong(params.id)!; // the loader 404s unknown songs and levels
  const level = params.level as LevelName;
  const chart = useJson<ChartPlays>(
    `/api/charts/${encodeURIComponent(song.id)}/${level}?page=${page}${verified ? "&verified=1" : ""}`,
  );

  const pages = Math.max(1, Math.ceil((chart?.count ?? 0) / PLAYS_PAGE));
  const constant = song.constants[LEVELS.indexOf(level)] ?? 0;
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <div className="chart-player-bar">
          <Link
            to="/leaderboard"
            search={{ verified: verified || undefined }}
            className="btn btn-ghost"
          >
            <span className="chart-player-back">
              <Arrow />
            </span>
            {t.tabs.leaderboard}
          </Link>
          <div className="chart-player-heading">
            <h1 className="panel-title">
              <Link to="/charts/$id" params={{ id: song.id }}>
                {song.title}
              </Link>
            </h1>
            <p className="meta">
              {song.artist} · {level} {constant.toFixed(1)}
            </p>
          </div>
          <span className="chart-player-levels">
            {songLevels(song.id).map((name) => (
              <Link
                key={name}
                to="/charts/$id/plays/$level"
                params={{ id: song.id, level: name }}
                search={{ verified: verified || undefined }}
                aria-current={name === level ? "page" : undefined}
              >
                <Difficulty level={name} />
              </Link>
            ))}
          </span>
        </div>
        <section className="panel">
          <div className="panel-head">
            <h2 className="panel-title">{t.song.plays}</h2>
            <ScopeSwitch verified={verified} />
          </div>
          <div className="chart-stats-scroll">
            <table className="song-diff-table">
              <PlayHeadings after={[t.song.played, ""]} />
              <tbody>
                {chart?.plays.map((play) => (
                  <tr key={play.id}>
                    <PlayCells play={play} />
                    <td className="meta">{play.date ? format.date(play.date) : "-"}</td>
                    <td>
                      {play.replay && (
                        <Link
                          to="/replays/$id"
                          params={{ id: play.replay }}
                          className="link-button"
                        >
                          {t.song.watch}
                        </Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <Pager page={page} pages={pages} />
        </section>
      </main>
    </>
  );
}
