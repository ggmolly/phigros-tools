import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";
import * as v from "valibot";
import { catalogSong } from "../catalog";
import { useFormat, useT } from "../i18n";
import type { Board, Modded, Play, PlayerName, PlayStatus, ReplayInfo } from "../plays";
import { Arrow } from "./arrow";
import { Modifiers } from "./modifiers";
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

/**
 * The song a page is about (its ranking, its preview, a replay of it), over the lines that describe it: the cover
 * and the title are one link to the song's page.
 */
export function SongHeading({
  song,
  children,
}: {
  song: { id: string; title: string };
  children: ReactNode;
}) {
  return (
    <div className="chart-player-heading song-heading">
      <h1 className="panel-title">
        <Link to="/charts/$id" params={{ id: song.id }} className="song-link">
          <img src={`/covers/${song.id}.thumb.avif`} alt="" />
          {song.title}
          <Arrow />
        </Link>
      </h1>
      {children}
    </div>
  );
}

/** A rank's cell: the first three places stand out, in the game's phi yellow, then silver and bronze. */
export function Place({ rank }: { rank: number }) {
  return <td className={rank <= 3 ? `num place place-${rank}` : "num meta"}>{rank}</td>;
}

/** Verified, Imported, Declared, Pending or Unverified, with what it means on hover. */
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

/** A replay's timing accuracy, explained on hover, "-" without a replay. */
export function Timing({ timing }: { timing: number | null }) {
  const t = useT();
  if (timing === null) return <span className="meta">-</span>;
  return (
    <span className="timing" title={t.song.timingHelp}>
      {timing.toFixed(2)}%
    </span>
  );
}

/**
 * A score as the game shows it. One played with modifiers shows the total they give with their plates, and the
 * score itself on hover.
 */
export function Score({ play }: { play: Modded }) {
  return (
    <span className="score" title={play.mods ? score7(play.score) : undefined}>
      {score7(play.total)}
      <Modifiers mods={play.mods} />
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
      <td className="num record-score">
        <Score play={play} />
      </td>
      <td className="num">{play.accuracy.toFixed(2)}%</td>
      <td className="num">
        <Timing timing={play.timing} />
      </td>
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
    t.song.timing,
    t.song.rank,
    t.song.status,
    ...after,
  ];
  return (
    <thead>
      <tr>
        {names.map((name) => (
          <th key={name} scope="col" title={name === t.song.timing ? t.song.timingHelp : undefined}>
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

/**
 * A ranking's search: ?page= from 1 (anything else is the first page), ?verified=true counting verified replays only,
 * and on a chart ?mods=true for its plays with modifiers.
 */
export const RankingSearch = v.object({
  page: v.fallback(
    v.optional(
      v.pipe(v.unknown(), v.transform(Number), v.finite(), v.minValue(1), v.transform(Math.floor)),
    ),
    undefined,
  ),
  verified: v.fallback(v.optional(v.boolean()), undefined),
  mods: v.fallback(v.optional(v.boolean()), undefined),
});

/**
 * All counts verified replays and imported records, Verified only verified replays, and where a chart offers it
 * Modifiers its plays with some. Switching starts at page 1.
 */
export function ScopeSwitch({ board, modifiers }: { board: Board; modifiers?: boolean }) {
  const t = useT();
  const labels = [t.common.all, t.song.replayStatus.verified, t.song.modifiers];
  return (
    // biome-ignore lint/a11y/useSemanticElements: like DifficultyFilter, a fieldset would need a style reset
    <div className="seg" role="group" aria-label={t.song.status}>
      {labels.slice(0, modifiers ? 3 : 2).map((label, option) => (
        <Link
          key={label}
          to="."
          search={(search) => ({
            ...search,
            verified: option === 1 || undefined,
            mods: option === 2 || undefined,
            page: undefined,
          })}
          className="seg-option"
          aria-pressed={board === option}
        >
          {label}
        </Link>
      ))}
    </div>
  );
}
