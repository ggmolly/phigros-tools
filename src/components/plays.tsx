import { Link } from "@tanstack/react-router";
import * as v from "valibot";
import { useFormat, useT } from "../i18n";
import type { Play, PlayerName, PlayStatus } from "../plays";
import { Avatar, Rank, score7 } from "./primitives";

/** The player's avatar and name#0042, linking to their page, the number dimmed so the name reads first. */
export function PlayerTag({ player }: { player: PlayerName }) {
  return (
    <Link to="/players/$id" params={{ id: player.id }} className="leaderboard-player">
      <Avatar name={player.avatar} className="leaderboard-avatar" />
      <span>
        {player.name}
        <span className="meta">#{String(player.number).padStart(4, "0")}</span>
      </span>
    </Link>
  );
}

/** Verified or Imported, with what it means on hover. */
export function PlayStatusLabel({ status }: { status: PlayStatus }) {
  const t = useT();
  return (
    <>
      {t.song.replayStatus[status]}
      <abbr className="stat-help" title={t.song.replayStatusHelp[status]}>
        ?
      </abbr>
    </>
  );
}

/** A play's rank, player, score, accuracy and grade, as cells of a table row. */
export function PlayCells({ play }: { play: Play }) {
  return (
    <>
      <td className="num meta">{play.rank}</td>
      <td>
        <PlayerTag player={play.player} />
      </td>
      <td className="num record-score">{score7(play.score)}</td>
      <td className="num">{play.accuracy.toFixed(2)}%</td>
      <td>
        <Rank score={play.score} fc={play.fc} />
      </td>
      <td className="meta">
        <PlayStatusLabel status={play.status} />
      </td>
    </>
  );
}

/** The headings of PlayCells, between those of the table's own columns. */
export function PlayHeadings({ before = [], after = [] }: { before?: string[]; after?: string[] }) {
  const t = useT();
  const names = [
    ...before,
    "#",
    t.song.player,
    t.song.score,
    t.song.acc,
    t.song.rank,
    t.song.status,
    ...after,
  ];
  return (
    <thead>
      <tr>
        {names.map((name) => (
          <th key={name} scope="col">
            {name}
          </th>
        ))}
      </tr>
    </thead>
  );
}

/** Previous and next links around "Page X of Y", kept in the URL as ?page=. */
export function Pager({ page, pages }: { page: number; pages: number }) {
  const t = useT();
  const format = useFormat();
  if (pages <= 1) return null;
  return (
    <nav className="plays-pager">
      {page > 1 ? (
        <Link to="." search={(search) => ({ ...search, page: page - 1 })} className="link-button">
          {t.song.previous}
        </Link>
      ) : (
        <span />
      )}
      <span className="meta">{t.song.pageOf(format.number(page), format.number(pages))}</span>
      {page < pages ? (
        <Link to="." search={(search) => ({ ...search, page: page + 1 })} className="link-button">
          {t.song.next}
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

/** ?page= from 1, anything else is the first page. */
export const PageSearch = v.object({
  page: v.fallback(
    v.optional(
      v.pipe(v.unknown(), v.transform(Number), v.finite(), v.minValue(1), v.transform(Math.floor)),
    ),
    undefined,
  ),
});
