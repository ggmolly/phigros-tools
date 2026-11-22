import { createFileRoute, Link } from "@tanstack/react-router";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { RoomChartLabel, RoomName } from "../components/rooms";
import { useT } from "../i18n";
import { useLiveReload } from "../live";
import { getRooms, ROOM_PLAYERS } from "../rooms";
import { headT, pageLinks, pageMeta } from "../seo";
import { topics } from "../topics";

export const Route = createFileRoute("/rooms/")({
  loader: () => getRooms(),
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.tabs.rooms,
        description: t.rooms.description,
        path: "/rooms",
        locale,
      }),
      links: pageLinks("/rooms", locale),
    };
  },
  component: RoomsPage,
});

/** The open rooms of Phigros++, the fullest first, each row leading to its room. */
function RoomsPage() {
  const rooms = Route.useLoaderData();
  const t = useT();
  useLiveReload([topics.rooms]);
  return (
    <>
      <SiteHeader />
      <main className="app-shell rooms-page">
        <div className="leaderboard-head">
          <div>
            <h1>{t.tabs.rooms}</h1>
            <p className="ppp-cta">
              {t.rooms.intro}{" "}
              <Link to="/phigrospp" className="text-link">
                {t.rooms.make}
              </Link>
            </p>
          </div>
        </div>
        {rooms.length === 0 && (
          <section className="panel">
            <p className="meta">{t.rooms.empty}</p>
          </section>
        )}
        <ul className="rooms">
          {rooms.map((room) => (
            <li key={room.id}>
              <Link to="/rooms/$id" params={{ id: room.id }} className="panel room arrow-link">
                {room.chart && (
                  <img
                    className="room-cover"
                    src={`/covers/${room.chart.song}.thumb.avif`}
                    alt=""
                    onError={(event) => {
                      event.currentTarget.hidden = true;
                    }}
                  />
                )}
                <h2 className="room-name">
                  <RoomName name={room.name} locked={room.locked} />
                </h2>
                <p className="meta room-on">
                  {room.locked ? (
                    t.rooms.password
                  ) : room.chart ? (
                    <RoomChartLabel chart={room.chart} />
                  ) : (
                    t.rooms.picking
                  )}
                </p>
                <p className="room-count">
                  {room.playing && (
                    <span className="status status-verified">{t.rooms.playing}</span>
                  )}
                  {t.rooms.players(room.players, ROOM_PLAYERS)}
                </p>
                <Arrow />
              </Link>
            </li>
          ))}
        </ul>
      </main>
    </>
  );
}
