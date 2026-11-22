import { catalogSong } from "../catalog";
import { useFormat, useT } from "../i18n";
import { totalOf } from "../modifiers";
import type { PlayerName } from "../plays";
import type { Match, RoomChart, RoomView, Standing } from "../rooms";
import { Modifiers } from "./modifiers";
import { ChartName } from "./player";
import { Place, PlayerTag } from "./plays";
import { DATE_TIME, Difficulty, Rank, score7 } from "./primitives";

// lucide's lock and crown
const LOCK =
  "M5 11h14a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-7a2 2 0 0 1 2-2M7 11V7a5 5 0 0 1 10 0v4";
const CROWN =
  "M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294zM5 21h14";

function Icon({ d, label, className = "" }: { d: string; label: string; className?: string }) {
  return (
    <svg className={`mod-icon ${className}`} viewBox="0 0 24 24" role="img" aria-label={label}>
      <title>{label}</title>
      <path d={d} />
    </svg>
  );
}

/** A room's name, with a lock after it when it needs a password. */
export function RoomName({ name, locked }: { name: string; locked: boolean }) {
  const t = useT();
  return (
    <>
      {name}
      {locked && <Icon d={LOCK} label={t.rooms.password} className="room-lock" />}
    </>
  );
}

/** The chart a room is on, as text: its cover, level, title and modifiers. A chart the site doesn't know shows its id. */
export function RoomChartLabel({ chart }: { chart: RoomChart }) {
  return (
    <span className="profile-chart">
      <Difficulty level={chart.level} />
      <span className="record-title">{catalogSong(chart.song)?.title ?? chart.song}</span>
      <Modifiers mods={chart.mods} />
    </span>
  );
}

/**
 * A table's headings: the first `text` ones are over text, the last of them over the players, then the others over
 * numbers, which end their column.
 */
function Headings({ names, text = 2 }: { names: string[]; text?: number }) {
  return (
    <thead>
      <tr>
        {names.map((name, index) => (
          <th
            key={name}
            scope="col"
            className={index < text - 1 ? undefined : index < text ? "room-player" : "end"}
          >
            {name}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function Num({ children, title }: { children: React.ReactNode; title?: string }) {
  return (
    <td className="num end" title={title}>
      {children}
    </td>
  );
}

/** A table that scrolls sideways when its columns don't fit, reachable from the keyboard. */
function Scroll({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a region that scrolls must take focus to be scrolled by keys
    <section className="chart-stats-scroll" aria-label={label} tabIndex={0}>
      <table className="song-diff-table">{children}</table>
    </section>
  );
}

function Player({ player, host }: { player: PlayerName; host?: boolean }) {
  const t = useT();
  return (
    <td className="room-player">
      <PlayerTag player={player}>
        {host && <Icon d={CROWN} label={t.rooms.host} className="room-crown" />}
      </PlayerTag>
    </td>
  );
}

/**
 * An open room: the chart its host picked, then its players. In the lobby they say whether they're ready, during a
 * match they're ranked by the score they have so far.
 */
export function Lobby({ room }: { room: RoomView }) {
  const t = useT();
  const mods = room.chart?.mods ?? 0;
  const players = room.playing ? room.players.toSorted((a, b) => b.score - a.score) : room.players;
  return (
    <section className="panel room-live">
      <div className="panel-head">
        <h2 className="panel-title">
          {room.chart ? (
            catalogSong(room.chart.song) ? (
              <ChartName chart={room.chart} />
            ) : (
              <RoomChartLabel chart={room.chart} />
            )
          ) : (
            t.rooms.picking
          )}
        </h2>
        {room.playing && <span className="status status-verified">{t.rooms.playing}</span>}
      </div>
      <Scroll label={t.leaderboard.players}>
        {room.playing ? (
          <Headings names={["#", t.song.player, t.song.score, t.song.acc]} />
        ) : (
          <Headings names={[t.song.player, ""]} text={1} />
        )}
        <tbody>
          {players.map((seat, index) => {
            const host = seat.player.id === room.host;
            // in the match, or out of it with the score they left it with
            const scored = seat.playing || seat.score > 0;
            const out = seat.able ? t.rooms.waiting : t.rooms.missing;
            return (
              <tr key={seat.player.id}>
                {room.playing && <Place rank={index + 1} />}
                <Player player={seat.player} host={host} />
                {room.playing ? (
                  scored ? (
                    <>
                      <Num>{score7(totalOf(seat.score, mods))}</Num>
                      <Num>{seat.accuracy.toFixed(2)}%</Num>
                    </>
                  ) : (
                    <td className="meta end" colSpan={2}>
                      {out}
                    </td>
                  )
                ) : (
                  <td className="meta end">
                    {seat.able
                      ? !host && (
                          <span className={seat.ready ? "status status-verified" : "status"}>
                            {seat.ready ? t.rooms.ready : t.rooms.notReady}
                          </span>
                        )
                      : t.rooms.missing}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </Scroll>
    </section>
  );
}

/** Who won the most of a room's matches, then who scored the most over them. */
export function Standings({ standings }: { standings: Standing[] }) {
  const t = useT();
  const format = useFormat();
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.rooms.standings}</h2>
      </div>
      <Scroll label={t.rooms.standings}>
        <Headings names={["#", t.song.player, t.rooms.wins, t.rooms.matches, t.rooms.total]} />
        <tbody>
          {standings.map((standing, index) => (
            <tr key={standing.player.id}>
              <Place rank={index + 1} />
              <Player player={standing.player} />
              <Num>{format.number(standing.wins)}</Num>
              <Num>{format.number(standing.matches)}</Num>
              <Num>{format.number(standing.total)}</Num>
            </tr>
          ))}
        </tbody>
      </Scroll>
    </section>
  );
}

/** The matches a room played, latest first: the chart, then the ranking of who finished it. */
export function Matches({ matches }: { matches: Match[] }) {
  const t = useT();
  const format = useFormat();
  const headings = [
    "#",
    t.song.player,
    t.song.score,
    t.song.acc,
    t.profile.maxCombo,
    "Perfect",
    "Good",
    "Bad",
    "Miss",
    t.song.rank,
  ];
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.rooms.matches}</h2>
        <span className="panel-count">{format.number(matches.length)}</span>
      </div>
      {matches.map((match) => (
        <article key={match.id} className="match">
          <header>
            <h3>
              <ChartName chart={match} />
            </h3>
            <time className="meta" dateTime={new Date(match.date).toISOString()}>
              {format.date(match.date, DATE_TIME)}
            </time>
          </header>
          <Scroll label={catalogSong(match.song)?.title ?? match.song}>
            <Headings names={headings} />
            <tbody>
              {match.plays.map((play) => (
                <tr key={play.player.id}>
                  <Place rank={play.rank} />
                  <Player player={play.player} />
                  <Num title={match.mods ? score7(play.score) : undefined}>
                    {score7(play.total)}
                  </Num>
                  <Num>{play.accuracy.toFixed(2)}%</Num>
                  <Num>{play.maxcombo}</Num>
                  <Num>{play.perfect}</Num>
                  <Num>{play.good}</Num>
                  <Num>{play.bad}</Num>
                  <Num>{play.miss}</Num>
                  <td className="end">
                    <Rank score={play.score} fc={play.bad + play.miss === 0} />
                  </td>
                </tr>
              ))}
            </tbody>
          </Scroll>
        </article>
      ))}
    </section>
  );
}
