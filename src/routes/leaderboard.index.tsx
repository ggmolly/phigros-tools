import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { Pager, PlayerTag } from "../components/plays";
import { useT } from "../i18n";
import { getPlayerRanking, PLAYS_PAGE } from "../plays";

export const Route = createFileRoute("/leaderboard/")({
  loaderDeps: ({ search }) => ({
    page: search.page ?? 1,
    q: search.q ?? "",
    verified: search.verified ?? false,
  }),
  loader: ({ deps }) => getPlayerRanking({ data: deps }),
  component: Players,
});

/** Players by RKS, a page at a time, searchable by name or name#0042. */
function Players() {
  const { page, q } = Route.useLoaderDeps();
  const ranking = Route.useLoaderData();
  const navigate = useNavigate({ from: Route.fullPath });
  const t = useT();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.leaderboard.players}</h2>
      </div>
      {/* uncontrolled, the search only changes once its page loaded and would undo what's being typed */}
      <input
        className="field search-field"
        type="search"
        placeholder={t.leaderboard.searchPlayers}
        aria-label={t.leaderboard.searchPlayers}
        defaultValue={q}
        onChange={(event) =>
          void navigate({
            search: (search) => ({
              ...search,
              q: event.target.value || undefined,
              page: undefined,
            }),
            replace: true,
          })
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
            {ranking.players.map((player) => (
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
      {!ranking.count && (
        <p className="meta">{q ? t.leaderboard.noPlayers : t.leaderboard.noRanked}</p>
      )}
      <Pager page={page} pages={Math.ceil(ranking.count / PLAYS_PAGE)} />
    </section>
  );
}
