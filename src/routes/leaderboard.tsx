import { createFileRoute, Link, Outlet } from "@tanstack/react-router";
import { useState } from "react";
import * as v from "valibot";
import { catalogSong, searchFold } from "../catalog";
import { SiteHeader } from "../components/chrome";
import { RankingSearch, ScopeSwitch } from "../components/plays";
import { Difficulty } from "../components/primitives";
import { useFormat, useT } from "../i18n";
import { getChartCounts } from "../plays";
import { headT, pageLinks, pageMeta } from "../seo";

// the charts, beside the players (leaderboard.index.tsx) whose search and pages don't reload them. the server counts
// them once a minute (server/replays.ts), so they're kept as long
export const Route = createFileRoute("/leaderboard")({
  validateSearch: v.object({
    ...RankingSearch.entries,
    q: v.fallback(v.optional(v.string()), undefined),
  }),
  loaderDeps: ({ search }) => ({ verified: search.verified ?? false }),
  loader: ({ deps }) => getChartCounts({ data: deps.verified }),
  staleTime: 60_000,
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.tabs.leaderboard,
        description: t.leaderboard.description,
        path: "/leaderboard",
        locale,
      }),
      links: pageLinks("/leaderboard", locale),
    };
  },
  component: LeaderboardPage,
});

/** Every chart with uploaded plays, most players first, each opening its own ranking. */
function Charts() {
  const { verified = false } = Route.useSearch();
  const charts = Route.useLoaderData();
  const t = useT();
  const format = useFormat();
  const [query, setQuery] = useState("");
  const folded = searchFold(query);
  const shown = charts.flatMap((chart) => {
    const song = catalogSong(chart.song);
    return song &&
      searchFold(song.title, song.artist, song.illustrator, song.chapter).includes(folded)
      ? [{ ...chart, song }]
      : [];
  });
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.tabs.charts}</h2>
      </div>
      <input
        className="field search-field"
        type="search"
        placeholder={t.charts.searchPlaceholder}
        aria-label={t.charts.searchLabel}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="chart-stats-scroll">
        <table className="song-diff-table">
          <thead>
            <tr>
              {[t.song.difficulty, t.charts.song, t.leaderboard.players].map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((chart) => (
              <tr key={`${chart.song.id}:${chart.level}`}>
                <td>
                  <Difficulty level={chart.level} />
                </td>
                <td>
                  <Link
                    to="/charts/$id/plays/$level"
                    params={{ id: chart.song.id, level: chart.level }}
                    search={{ verified: verified || undefined }}
                  >
                    <span className="record-title">{chart.song.title}</span>
                  </Link>
                </td>
                <td className="num">{format.number(chart.count)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!charts.length && <p className="meta">{t.leaderboard.noCharts}</p>}
      {charts.length > 0 && !shown.length && <p className="meta">{t.charts.empty}</p>}
    </section>
  );
}

function LeaderboardPage() {
  const t = useT();
  const { verified = false } = Route.useSearch();
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <h1 className="sr-only">{t.tabs.leaderboard}</h1>
        <ScopeSwitch verified={verified} />
        <p className="ppp-cta">
          {t.ppp.leaderboardCta}{" "}
          <Link to="/phigrospp" className="text-link">
            {t.ppp.leaderboardJoin}
          </Link>
        </p>
        <div className="leaderboard-layout">
          <Outlet />
          <Charts />
        </div>
      </main>
    </>
  );
}
