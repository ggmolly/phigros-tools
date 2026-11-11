import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { catalogSong } from "../catalog";
import { SiteHeader } from "../components/chrome";
import { PlayStatusLabel } from "../components/plays";
import { Avatar, Difficulty, Rank, Stat, score7 } from "../components/primitives";
import { RksHistory } from "../components/rks-history";
import { useFormat, useT } from "../i18n";
import type { PlayedChart, PlayerProfile } from "../plays";
import { headT, pageMeta } from "../seo";

// players' pages change with every upload and unlisted ones must stay out of search results, so none are indexed
export const Route = createFileRoute("/players/$id")({
  head: ({ params, match }) => {
    const { locale, t } = headT(match);
    return {
      meta: [
        ...pageMeta({
          title: t.leaderboard.players,
          description: t.leaderboard.description,
          path: `/players/${params.id}`,
          locale,
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
  component: PlayerPage,
});

const TOP_SHOWN = 10;

/**
 * The player's card, laid out like the Overview's: who they are, their headline numbers beside the Cleared, Full
 * Combo and Phi bar, their intro, then the smaller numbers.
 */
function Card({ profile }: { profile: PlayerProfile }) {
  const t = useT();
  const format = useFormat();
  const { stats } = profile;
  const hours = Math.floor(stats.time / 3600);
  const minutes = Math.floor((stats.time % 3600) / 60);
  const details = [
    [t.profile.playTime, t.profile.duration(String(hours), String(minutes))],
    [t.profile.notesHit, format.number(stats.notes)],
    [t.profile.maxCombo, format.number(stats.maxcombo)],
    [t.profile.joined, format.date(profile.joined)],
    [t.profile.seen, format.date(profile.seen)],
  ];
  return (
    <section className="hero profile-card">
      <div className="hero-id">
        <Avatar className="hero-avatar" name={profile.player.avatar} />
        <h1 className="hero-name">
          <span className="hero-name-text">
            {profile.player.name}
            <span className="profile-number">
              #{String(profile.player.number).padStart(4, "0")}
            </span>
          </span>
        </h1>
        <p className="hero-rks">
          <span className="hero-rks-label">RKS</span>
          <span className="ranking-number">{profile.rks.toFixed(3)}</span>
        </p>
      </div>
      <div className="hero-stats">
        <Stat
          label={t.profile.globalRank}
          value={profile.rank ? `#${format.number(profile.rank)}` : "-"}
        />
        <Stat
          label={t.profile.accuracy}
          value={stats.accuracy === null ? "-" : `${stats.accuracy.toFixed(2)}%`}
        />
        <Stat label={t.profile.playCount} value={stats.plays} />
      </div>
      <div className="stat-bar">
        <div className="stat-row">
          <Stat label={t.common.cleared} value={stats.cleared} />
          <Stat label={t.menu.fullCombo} value={stats.fc} className="profile-fc" />
          <Stat label="Phi" value={stats.phi} className="profile-phi" />
        </div>
      </div>
      {profile.intro && <p className="hero-intro">{profile.intro}</p>}
      <dl className="profile-details">
        {details.map(([label, value]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** A song's title and difficulty, linking to the chart's ranking. */
function ChartName({ chart }: { chart: { song: string; level: string } }) {
  return (
    <span className="profile-chart">
      <Difficulty level={chart.level} />
      <Link to="/charts/$id/plays/$level" params={{ id: chart.song, level: chart.level }}>
        {catalogSong(chart.song)?.title ?? chart.song}
      </Link>
    </span>
  );
}

function Watch({ replay }: { replay: string | null }) {
  const t = useT();
  if (!replay) return <span />;
  return (
    <Link to="/replays/$id" params={{ id: replay }} className="link-button">
      {t.song.watch}
    </Link>
  );
}

/** A played chart's score, accuracy and grade, as cells of a list row. */
function Result({ play }: { play: PlayedChart }) {
  return (
    <>
      <span className="num record-score">{score7(play.score)}</span>
      <span className="num">{play.accuracy.toFixed(2)}%</span>
      <Rank score={play.score} fc={play.fc} />
    </>
  );
}

/** The bests by chart RKS: the ones counting towards the player's RKS show what they add, the others are dimmed. */
function TopPlays({ profile }: { profile: PlayerProfile }) {
  const t = useT();
  const [all, setAll] = useState(false);
  if (!profile.top.length) return null;
  const shown = all ? profile.top : profile.top.slice(0, TOP_SHOWN);
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.profile.topPlays}</h2>
      </div>
      <ol className="profile-list profile-top">
        {shown.map((play) => (
          <li
            key={`${play.song}:${play.level}`}
            className={play.counted ? undefined : "profile-uncounted"}
          >
            <ChartName chart={play} />
            <Result play={play} />
            <span className="num">
              {play.rks.toFixed(2)}
              {play.counted && <span className="meta"> +{(play.rks / 30).toFixed(3)}</span>}
            </span>
            <span className="meta">
              <PlayStatusLabel status={play.status} />
            </span>
            <Watch replay={play.replay} />
          </li>
        ))}
      </ol>
      {!all && profile.top.length > TOP_SHOWN && (
        <button type="button" className="btn btn-ghost profile-more" onClick={() => setAll(true)}>
          {t.profile.showMore}
        </button>
      )}
    </section>
  );
}

/** The rank each new verified best took on its chart, most recent first. */
function Activity({ profile }: { profile: PlayerProfile }) {
  const t = useT();
  const format = useFormat();
  if (!profile.activity.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.profile.recentActivity}</h2>
      </div>
      <ul className="profile-activity">
        {profile.activity.map((event) => (
          <li key={`${event.date}:${event.song}:${event.level}`}>
            <span>
              {t.profile.achieved(format.number(event.rank))} <ChartName chart={event} />
            </span>
            <span className="meta">{format.date(event.date)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** The last songs the player finished, whatever their score. */
function RecentPlays({ profile }: { profile: PlayerProfile }) {
  const t = useT();
  const format = useFormat();
  if (!profile.recent.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.profile.recentPlays}</h2>
      </div>
      <ol className="profile-list profile-recent">
        {profile.recent.map((play) => (
          <li key={`${play.date}:${play.song}:${play.level}`}>
            <ChartName chart={play} />
            <Result play={play} />
            <span className="meta">{play.date ? format.date(play.date) : "-"}</span>
            <Watch replay={play.replay} />
          </li>
        ))}
      </ol>
    </section>
  );
}

function PlayerPage() {
  const { id } = Route.useParams();
  const t = useT();
  const [profile, setProfile] = useState<PlayerProfile | null>();

  useEffect(() => {
    setProfile(undefined);
    fetch(`/api/players/${encodeURIComponent(id)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then(setProfile);
  }, [id]);

  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        {profile === null && (
          <section className="panel">
            <h1 className="panel-title">{t.notFound.title}</h1>
            <p className="meta">
              {t.notFound.body} <Link to="/leaderboard">{t.tabs.leaderboard}</Link>
            </p>
          </section>
        )}
        {profile && (
          <>
            <Card profile={profile} />
            <RksHistory history={profile.history} />
            <div className="profile-columns">
              <TopPlays profile={profile} />
              <div className="profile-side">
                <Activity profile={profile} />
                <RecentPlays profile={profile} />
              </div>
            </div>
          </>
        )}
      </main>
    </>
  );
}
