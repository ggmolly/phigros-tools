import { createFileRoute, Link, notFound } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { catalogSong } from "../catalog";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { score7 } from "../components/primitives";
import { RoomWatch, useRoomWatch, WatchDialog } from "../components/room-watch";
import { Lobby, Matches, RoomName, Standings } from "../components/rooms";
import { useT } from "../i18n";
import { useLive, useReload } from "../live";
import { CARDS, type PlayerName } from "../plays";
import { getRoom, ROOM_PLAYERS, type RoomChart, roomLink } from "../rooms";
import { headT, pageMeta, SITE } from "../seo";
import { COPIED_NOTE, shareLink } from "../share";
import { topics } from "../topics";

// a room changes all the time and is its players' own, so it stays out of search results. its link previews show its
// latest match (server/card.tsx)
export const Route = createFileRoute("/rooms/$id")({
  loader: async ({ params }) => {
    const page = await getRoom({ data: params.id });
    if (!page) throw notFound();
    return page;
  },
  head: ({ loaderData: page, match }) => {
    const { locale, t } = headT(match);
    if (!page) return {};
    const latest = page.matches[0];
    const title = `${page.name} · ${t.tabs.rooms}`;
    const description = latest
      ? t.rooms.latest(
          `${catalogSong(latest.song)?.title ?? latest.song} (${latest.level})`,
          latest.plays
            .map(
              ({ rank, player, total }) =>
                `${rank}. ${player.name}#${String(player.number).padStart(4, "0")} ${score7(total)}`,
            )
            .join(" · "),
        )
      : page.open?.locked
        ? t.rooms.private
        : page.open
          ? t.rooms.players(page.open.players, ROOM_PLAYERS)
          : t.rooms.closed;
    return {
      meta: [
        ...pageMeta({
          title,
          description,
          path: `/rooms/${page.id}`,
          locale,
          themeColor: page.themeColor,
          // the query skips any cached card from before the latest match
          image: {
            url: `${SITE}/og/room/${page.id}.jpg?${latest?.id ?? 0}`,
            ...CARDS.replay,
            alt: title,
          },
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: RoomPage,
});

/** Shares the page's link, saying so once it's copied. */
function Share() {
  const t = useT();
  const [copied, setCopied] = useState(0);
  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(0), COPIED_NOTE);
    return () => clearTimeout(timer);
  }, [copied]);
  return (
    <button
      type="button"
      className="btn btn-ghost"
      onClick={() =>
        void shareLink(location.href).then((done) => done && setCopied(performance.now()))
      }
    >
      {t.rooms.share}
      <span className="chart-player-copied" role="status">
        {copied > 0 && <span key={copied}>{t.player.linkCopied}</span>}
      </span>
    </button>
  );
}

function RoomPage() {
  const page = Route.useLoaderData();
  const t = useT();
  const reload = useReload();
  // the room as the server last sent it, until the page loads again (a match ended, the room closed)
  const [room, setRoom] = useState(page.room);
  const [from, setFrom] = useState(page);
  if (from !== page) {
    setFrom(page);
    setRoom(page.room);
  }
  // a room with a password only tells the list how many play in it
  useLive([topics.room(page.id), page.open?.locked && topics.rooms], (event, data) => {
    if (event === "room") setRoom(JSON.parse(data));
    else reload();
  });
  // watching it, the room comes from its own socket, with a password too
  const watching = useRoomWatch(page.id);
  const live = watching.room;
  const shown = live ?? room;
  const [asking, setAsking] = useState(false);
  const [followed, setFollowed] = useState<{ player: PlayerName; chart: RoomChart; at: number }>();
  const follow = (id: string) => {
    const seat = live?.players.find((each) => each.player.id === id);
    if (live?.chart && seat)
      setFollowed({ player: seat.player, chart: live.chart, at: Date.now() });
  };
  // each match starts by following its first player
  const [was, setWas] = useState(false);
  if (live && live.playing !== was) {
    setWas(live.playing);
    const first = live.players.find((seat) => seat.playing);
    if (live.playing && live.chart && first)
      setFollowed({ player: first.player, chart: live.chart, at: Date.now() });
  }
  const { follow: hear } = watching;
  useEffect(() => {
    if (followed) hear(followed.player.id);
  }, [followed, hear]);
  // biome-ignore lint/correctness/useExhaustiveDependencies: reload is made anew each render, the room closing is what counts
  useEffect(() => {
    if (live === null || watching.error === "gone") reload();
  }, [live, watching.error]);
  const playing = shown?.playing ?? page.open?.playing;
  const players = shown
    ? shown.players.filter((seat) => !seat.watching).length
    : page.open?.players;
  return (
    <>
      <SiteHeader />
      <main className="app-shell room-page">
        <div className="chart-player-bar">
          <Link to="/rooms" className="btn btn-ghost">
            <span className="chart-player-back">
              <Arrow />
            </span>
            {t.tabs.rooms}
          </Link>
          <div className="chart-player-heading">
            <h1 className="panel-title">
              <RoomName name={shown?.name ?? page.name} locked={!!page.open?.locked} />
            </h1>
            <p className="meta">
              {page.open ? t.rooms.players(players ?? 0, ROOM_PLAYERS) : t.rooms.closed}
              {playing && ` · ${t.rooms.playing}`}
              {!!shown?.watchers && ` · ${t.rooms.watchers(shown.watchers)}`}
            </p>
          </div>
          <span className="room-actions">
            {page.open && (
              <a className="btn" href={roomLink(page.id)}>
                {t.rooms.join} <Arrow />
              </a>
            )}
            {page.open && !live && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => (page.open?.locked ? setAsking(true) : watching.watch(""))}
              >
                {t.rooms.watch}
              </button>
            )}
            <Share />
          </span>
        </div>
        <WatchDialog
          open={asking && !live}
          error={watching.error}
          onWatch={watching.watch}
          onClose={() => setAsking(false)}
        />
        {watching.error === "full" && !asking && <p className="meta">{t.rooms.tooMany}</p>}
        {page.open?.locked && !live && (
          <section className="panel">
            <p className="meta">{t.rooms.private}</p>
          </section>
        )}
        {live && followed && (
          <RoomWatch
            key={followed.at}
            chart={followed.chart}
            player={followed.player}
            frames={watching.frames}
          />
        )}
        {shown && (
          <Lobby
            room={shown}
            following={followed?.player.id}
            onFollow={live ? follow : undefined}
          />
        )}
        {page.standings.length > 0 && <Standings standings={page.standings} />}
        {page.matches.length > 0 && <Matches matches={page.matches} />}
      </main>
    </>
  );
}
