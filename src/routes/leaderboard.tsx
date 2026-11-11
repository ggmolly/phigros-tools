import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import * as v from "valibot";
import { catalogSong, searchFold } from "../catalog";
import { SiteHeader } from "../components/chrome";
import { Pager, PlayerTag, RankingSearch, ScopeSwitch } from "../components/plays";
import { Difficulty } from "../components/primitives";
import { useFormat, useT } from "../i18n";
import { type ChartCount, PLAYS_PAGE, type PlayerRanking } from "../plays";
import { headT, pageLinks, pageMeta } from "../seo";

export const Route = createFileRoute("/leaderboard")({
  validateSearch: v.object({
    ...RankingSearch.entries,
    q: v.fallback(v.optional(v.string()), undefined),
  }),
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

/** Players by RKS, a page at a time, searchable by name or name#0042. */
function Players() {
  const { page = 1, q = "", verified = false } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const t = useT();
  const [ranking, setRanking] = useState<PlayerRanking>();
  useEffect(() => {
    fetch(`/api/players?page=${page}&q=${encodeURIComponent(q)}${verified ? "&verified=1" : ""}`)
      .then((response) => response.json())
      .then(setRanking);
  }, [page, q, verified]);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.leaderboard.players}</h2>
      </div>
      <input
        className="field search-field"
        type="search"
        placeholder={t.leaderboard.searchPlayers}
        aria-label={t.leaderboard.searchPlayers}
        value={q}
        onChange={(event) =>
          void navigate({ search: { q: event.target.value || undefined }, replace: true })
        }
      />
      <div className="chart-stats-scroll">
        <table className="song-diff-table">
          <thead>
            <tr>
              {["#", t.song.player, "RKS"].map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ranking?.players.map((player) => (
              <tr key={player.rank}>
                <td className="num meta">{player.rank}</td>
                <td>
                  <PlayerTag player={player.player} />
                </td>
                <td className="num">{player.rks.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {ranking && !ranking.count && q && <p className="meta">{t.leaderboard.noPlayers}</p>}
      <Pager page={page} pages={Math.ceil((ranking?.count ?? 0) / PLAYS_PAGE)} />
    </section>
  );
}

/** Every chart with uploaded plays, most players first, each opening its own ranking. */
function Charts() {
  const { verified = false } = Route.useSearch();
  const t = useT();
  const format = useFormat();
  const [charts, setCharts] = useState<ChartCount[]>([]);
  const [query, setQuery] = useState("");
  useEffect(() => {
    fetch(`/api/charts${verified ? "?verified=1" : ""}`)
      .then((response) => response.json())
      .then(setCharts);
  }, [verified]);
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
        <div className="leaderboard-layout">
          <Players />
          <Charts />
        </div>
      </main>
    </>
  );
}
