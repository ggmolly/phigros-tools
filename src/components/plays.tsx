import { Link } from "@tanstack/react-router";
import * as v from "valibot";
import { catalogSong } from "../catalog";
import { useFormat, useT } from "../i18n";
import type { Play, PlayerName, PlayStatus, ReplayInfo } from "../plays";
import { Arrow } from "./arrow";
import { Avatar, Rank, score7 } from "./primitives";

/** The player's avatar and name#0042, linking to their page, the number dimmed so the name reads first. */
export function PlayerTag({ player }: { player: PlayerName }) {
  return (
    <Link to="/players/$id" params={{ id: player.id }} className="leaderboard-player arrow-link">
      <Avatar name={player.avatar} className="leaderboard-avatar" />
      <span>
        {player.name}
        <span className="meta">#{String(player.number).padStart(4, "0")}</span>
      </span>
      <Arrow />
    </Link>
  );
}

/** A chart as a link to its ranking: the song's cover, its title, and an arrow that says it leads somewhere. */
export function ChartLink({
  song,
  level,
  verified,
}: {
  song: string;
  level: string;
  verified?: boolean;
}) {
  return (
    <Link
      to="/charts/$id/plays/$level"
      params={{ id: song, level }}
      search={{ verified: verified || undefined }}
      className="chart-link arrow-link"
    >
      <img src={`/covers/${song}.thumb.avif`} alt="" loading="lazy" />
      <span className="record-title">{catalogSong(song)?.title ?? song}</span>
      <Arrow />
    </Link>
  );
}

/** A rank's cell: the first three places stand out, in the game's phi yellow, then silver and bronze. */
export function Place({ rank }: { rank: number }) {
  return <td className={rank <= 3 ? `num place place-${rank}` : "num meta"}>{rank}</td>;
}

/** Verified, Imported, Pending or Unverified, with what it means on hover. */
export function PlayStatusLabel({ status }: { status: PlayStatus | ReplayInfo["status"] }) {
  const t = useT();
  return (
    <span className={`status status-${status}`} title={t.song.replayStatusHelp[status]}>
      {status === "verified" && (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 12.5l5.5 5.5L20 6.5" />
        </svg>
      )}
      {t.song.replayStatus[status]}
    </span>
  );
}

/** A play's rank, player, score, accuracy and grade, as cells of a table row. */
export function PlayCells({ play }: { play: Play }) {
  return (
    <>
      <Place rank={play.rank} />
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

/** A ranking's search: ?page= from 1 (anything else is the first page), and ?verified=true counting verified replays only. */
export const RankingSearch = v.object({
  page: v.fallback(
    v.optional(
      v.pipe(v.unknown(), v.transform(Number), v.finite(), v.minValue(1), v.transform(Math.floor)),
    ),
    undefined,
  ),
  verified: v.fallback(v.optional(v.boolean()), undefined),
});

/** All counts verified replays and imported records, Verified only verified replays. Switching starts at page 1. */
export function ScopeSwitch({ verified }: { verified: boolean }) {
  const t = useT();
  return (
    // biome-ignore lint/a11y/useSemanticElements: like DifficultyFilter, a fieldset would need a style reset
    <div className="seg" role="group" aria-label={t.song.status}>
      {([false, true] as const).map((option) => (
        <Link
          key={String(option)}
          to="."
          search={(search) => ({ ...search, verified: option || undefined, page: undefined })}
          className="seg-option"
          aria-pressed={verified === option}
        >
          {option ? t.song.replayStatus.verified : t.common.all}
        </Link>
      ))}
    </div>
  );
}
