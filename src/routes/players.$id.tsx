import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { catalogSong } from "../catalog";
import { SiteHeader } from "../components/chrome";
import { Overview } from "../components/overview";
import { PlayStatusLabel } from "../components/plays";
import { Avatar, Difficulty, Rank, score7 } from "../components/primitives";
import type { SaveDocumentV1 } from "../document";
import { useFormat, useT } from "../i18n";
import { chartRks } from "../metrics";
import { LEVELS, type LevelName } from "../modules";
import type { PlayerProfile } from "../plays";
import { openArchive, parseArchive } from "../save";
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

const tag = (profile: PlayerProfile) =>
  `${profile.player.name}#${String(profile.player.number).padStart(4, "0")}`;

/** The card a player without an uploaded save gets: their avatar, name, RKS from their bests and intro. */
function Card({ profile }: { profile: PlayerProfile }) {
  return (
    <section className="hero">
      <div className="hero-id">
        <Avatar className="hero-avatar" name={profile.player.avatar} />
        <h1 className="hero-name">
          <span className="hero-name-text">{tag(profile)}</span>
        </h1>
        <p className="hero-rks">
          <span className="hero-rks-label">RKS</span>
          <span className="ranking-number">{profile.rks.toFixed(3)}</span>
        </p>
      </div>
      {profile.intro && <p className="hero-intro">{profile.intro}</p>}
    </section>
  );
}

/** A best's chart RKS, how much it is worth to the player's ranking. */
function chartRksOf(best: PlayerProfile["bests"][number]) {
  const constant = catalogSong(best.song)?.constants[LEVELS.indexOf(best.level as LevelName)];
  return constant == null ? 0 : chartRks(best.accuracy, constant);
}

/** Each chart's best the player uploaded, a replay or an imported record, linking to the chart's ranking, the top
 * ones (by chart RKS) or the most recent first. */
function Plays({ profile }: { profile: PlayerProfile }) {
  const t = useT();
  const format = useFormat();
  const [order, setOrder] = useState<"top" | "recent">("top");
  if (!profile.bests.length) return null;
  const bests = [...profile.bests].sort((a, b) =>
    order === "top" ? chartRksOf(b) - chartRksOf(a) : (b.date ?? 0) - (a.date ?? 0),
  );
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.song.plays}</h2>
        {/* biome-ignore lint/a11y/useSemanticElements: like DifficultyFilter, a fieldset would need a style reset */}
        <div className="seg" role="group" aria-label={t.song.plays}>
          {(["top", "recent"] as const).map((option) => (
            <button
              key={option}
              type="button"
              className="seg-option"
              aria-pressed={order === option}
              onClick={() => setOrder(option)}
            >
              {t.song[option]}
            </button>
          ))}
        </div>
      </div>
      <div className="chart-stats-scroll">
        <table className="song-diff-table">
          <thead>
            <tr>
              {[
                t.song.difficulty,
                t.charts.song,
                t.song.score,
                t.song.acc,
                t.song.rank,
                t.song.status,
                t.song.played,
                t.song.watch,
              ].map((name) => (
                <th key={name} scope="col">
                  {name === t.song.watch ? <span className="sr-only">{name}</span> : name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {bests.map((best) => {
              const song = catalogSong(best.song);
              return (
                <tr key={`${best.song}:${best.level}`}>
                  <td>
                    <Difficulty level={best.level} />
                  </td>
                  <td>
                    <Link
                      to="/charts/$id/plays/$level"
                      params={{ id: best.song, level: best.level }}
                    >
                      {song?.title ?? best.song}
                    </Link>
                  </td>
                  <td className="num record-score">{score7(best.score)}</td>
                  <td className="num">{best.accuracy.toFixed(2)}%</td>
                  <td>
                    <Rank score={best.score} fc={best.fc} />
                  </td>
                  <td className="meta">
                    <PlayStatusLabel status={best.status} />
                  </td>
                  <td className="meta">{best.date ? format.date(best.date) : "-"}</td>
                  <td>
                    {best.replay && (
                      <Link to="/replays/$id" params={{ id: best.replay }} className="link-button">
                        {t.song.watch}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PlayerPage() {
  const { id } = Route.useParams();
  const t = useT();
  const [profile, setProfile] = useState<PlayerProfile | null>();
  const [document, setDocument] = useState<SaveDocumentV1>();

  useEffect(() => {
    setProfile(undefined);
    setDocument(undefined);
    fetch(`/api/players/${encodeURIComponent(id)}`)
      .then((response) => (response.ok ? response.json() : null))
      .then((found: PlayerProfile | null) => {
        setProfile(found);
        if (!found?.save) return;
        // the uploaded save reads like one fetched from TapTap, see server/saves.ts
        return fetch(`/api/players/${encodeURIComponent(id)}/save`)
          .then((response) => response.arrayBuffer())
          .then((zip) => openArchive(new Uint8Array(zip)))
          .then((archive) =>
            setDocument(
              parseArchive(archive, {
                kind: "cloud",
                cloudUpdatedAt: new Date(found.save!).toISOString(),
              }),
            ),
          );
      });
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
        {profile &&
          (document ? (
            <Overview document={document} playerName={tag(profile)} />
          ) : (
            !profile.save && <Card profile={profile} />
          ))}
        {profile && <Plays profile={profile} />}
      </main>
    </>
  );
}
