import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { Pager, Place, PlayerTag } from "../components/plays";
import { Avatar } from "../components/primitives";
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
  // the first three stand on a podium, on the ranking's first page only: a search or a later page is a plain list
  const podium = page === 1 && !q ? ranking.players.filter((player) => player.rank <= 3) : [];
  const rest = ranking.players.slice(podium.length);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.leaderboard.players}</h2>
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
      </div>
      {podium.length > 0 && (
        <ol className="podium">
          {podium.map(({ rank, player, rks }) => (
            <li key={player.id}>
              <Link to="/players/$id" params={{ id: player.id }} className="podium-card arrow-link">
                <b className="podium-place">{rank}</b>
                <Avatar name={player.avatar} className="podium-avatar" />
                <span className="podium-name">
                  {player.name}
                  <span className="meta">#{String(player.number).padStart(4, "0")}</span>
                </span>
                <span className="podium-rks">{rks.toFixed(2)}</span>
                <Arrow />
              </Link>
            </li>
          ))}
        </ol>
      )}
      {rest.length > 0 && (
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
              {rest.map((player) => (
                <tr key={player.player.id}>
                  <Place rank={player.rank} />
                  <td>
                    <PlayerTag player={player.player} />
                  </td>
                  <td className="num">{player.rks.toFixed(2)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {!ranking.count && (
        <p className="meta">{q ? t.leaderboard.noPlayers : t.leaderboard.noRanked}</p>
      )}
      <Pager page={page} pages={Math.ceil(ranking.count / PLAYS_PAGE)} />
    </section>
  );
}
