import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { type CatalogSong, canonicalSongId, catalogSong, catalogSongs } from "../catalog";
import { type ChartStats, getSongDetails } from "../chartStats";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Difficulty, Rank, score7 } from "../components/primitives";
import { useT } from "../i18n";
import type { Locale } from "../i18n/locales";
import { MESSAGES, type Messages } from "../i18n/messages";
import { calculateRanking } from "../metrics";
import { LEVELS } from "../modules";
import { useSave } from "../save-context";
import { breadcrumbs, headT, jsonLd, localeUrl, pageLinks, pageMeta, SITE } from "../seo";

function mmss(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Stat key + formatter (+ whether it has a "(?)" explanation) for the chart-stats table; every field comes from the game's own chart files (see scripts/build-chart-stats.ts). */
const STAT_ROWS: [
  keyof Messages["song"]["stats"],
  (s: ChartStats, t: Messages) => string,
  boolean?,
][] = [
  ["notes", (s) => String(s.notes)],
  ["tap", (s) => String(s.tap)],
  ["drag", (s) => String(s.drag)],
  ["hold", (s) => String(s.hold)],
  ["flick", (s) => String(s.flick)],
  ["length", (s) => mmss(s.lengthSec)],
  ["avgDensity", (s) => `${s.avgNps.toFixed(1)}/s`, true],
  ["peakDensity", (s) => `${s.peakNps}/s`, true],
  [
    "largestChord",
    (s, t) => (s.maxChord === 1 ? t.song.chordOne : t.song.chordMany)(s.maxChord),
    true,
  ],
  ["chords", (s) => String(s.chordCount), true],
  [
    "holdTime",
    (s) =>
      `${mmss(s.holdSec)} (${s.lengthSec > 0 ? Math.round((s.holdSec / s.lengthSec) * 100) : 0}%)`,
    true,
  ],
  ["longestGap", (s) => `${s.longestGapSec.toFixed(1)}s`, true],
  ["notesPerLine", (s) => (s.notes / s.lines).toFixed(1), true],
  ["bpm", (s) => (s.bpmMin === s.bpmMax ? String(s.bpm) : `${s.bpmMin}–${s.bpmMax}`)],
  ["scrollSpeed", (s) => `${s.speedMin}×–${s.speedMax}×`, true],
  ["speedChanges", (s) => String(s.speedChanges), true],
  ["judgeLines", (s) => String(s.lines), true],
  ["aboveBelow", (s) => `${s.above} / ${s.below}`, true],
  ["motionEvents", (s) => String(s.motionEvents), true],
];

/** "a", "a and b", "a, b and c", in the page's language. */
const list = (items: string[], locale: Locale) =>
  new Intl.ListFormat(locale, { type: "conjunction" }).format(items);

/**
 * A few natural sentences about a song for search snippets and link previews: who made it, where it's
 * from, which difficulties exist and who charted them, and what its hardest chart is like.
 */
function describe(
  song: CatalogSong,
  songStats: (ChartStats | null)[] | null,
  locale: Locale,
): string {
  const t = MESSAGES[locale].seo;
  const levels = LEVELS.flatMap((level, index) =>
    song.constants[index] == null ? [] : [{ level, index, constant: song.constants[index]! }],
  );
  const byCharter = new Map<string, string[]>();
  for (const { level, index } of levels) {
    const charter = song.charters[index]?.trim();
    if (charter) byCharter.set(charter, [...(byCharter.get(charter) ?? []), level]);
  }
  const charters =
    byCharter.size === 1
      ? t.allChartedBy([...byCharter.keys()][0]!)
      : byCharter.size > 1
        ? t.chartedBy(
            list(
              [...byCharter].map(([name, charted]) => `${name} (${charted.join("/")})`),
              locale,
            ),
          )
        : "";
  const hardest = levels.at(-1);
  const stats = hardest && songStats?.[hardest.index];
  const bpm =
    stats && (stats.bpmMin === stats.bpmMax ? `${stats.bpm}` : `${stats.bpmMin}–${stats.bpmMax}`);
  const chartList = list(
    levels.map(({ level, constant }) => `${level} ${constant.toFixed(1)}`),
    locale,
  );
  return (
    [
      t.songIntro(song.title, song.artist, song.chapter),
      levels.length === 1
        ? t.oneChart(chartList, charters)
        : t.nCharts(levels.length, chartList, charters),
      stats &&
        t.hardest(hardest.level, stats.notes.toLocaleString(locale), mmss(stats.lengthSec), bpm!),
      song.illustrator && t.coverBy(song.illustrator),
    ]
      .filter(Boolean)
      // CJK sentences run on without spaces.
      .join(/^(zh|ja)/.test(locale) ? "" : " ")
  );
}

const songPath = (song: CatalogSong) => `/charts/${encodeURIComponent(song.id)}`;

export const Route = createFileRoute("/charts/$id")({
  loader: ({ params }) => {
    if (!catalogSong(params.id)) throw notFound(); // a real 404, not a 200 "not found" page
    return getSongDetails({ data: params.id });
  },
  head: ({ params, loaderData, match }) => {
    const { locale, t } = headT(match);
    const song = catalogSong(params.id);
    if (!song)
      return {
        meta: [
          ...pageMeta({
            title: t.seo.songNotFound,
            description: t.seo.songNotFoundDescription,
            path: "/charts",
            locale,
          }),
          { name: "robots", content: "noindex" },
        ],
      };
    const title = `${song.title} — ${song.artist}`;
    const image = `${SITE}/covers/${encodeURIComponent(song.id)}.og.jpg`;
    const description = describe(song, loaderData?.stats ?? null, locale);
    return {
      meta: pageMeta({
        title,
        description,
        path: songPath(song),
        locale,
        type: "music.song",
        themeColor: loaderData?.themeColor,
        image: {
          url: image,
          width: 1024,
          height: 540,
          alt: song.illustrator
            ? t.seo.coverAltBy(song.title, song.illustrator)
            : t.seo.coverAlt(song.title),
        },
      }),
      links: pageLinks(songPath(song), locale),
      scripts: [
        jsonLd({
          "@graph": [
            breadcrumbs(
              [
                ["Phigros Tools", "/"],
                [t.tabs.charts, "/charts"],
                [song.title, songPath(song)],
              ],
              locale,
            ),
            {
              "@type": "MusicRecording",
              name: song.title,
              url: localeUrl(songPath(song), locale),
              inLanguage: locale,
              description,
              image,
              byArtist: { "@type": "MusicGroup", name: song.artist },
              ...(song.illustrator
                ? { contributor: { "@type": "Person", name: song.illustrator } }
                : {}),
              inAlbum: {
                "@type": "MusicAlbum",
                name: song.chapter,
                url: `${localeUrl("/charts", locale)}?chapter=${encodeURIComponent(song.chapter)}`,
              },
            },
          ],
        }),
      ],
    };
  },
  notFoundComponent: SongNotFound,
  component: SongPage,
});

function SongNotFound() {
  const t = useT();
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <section className="panel">
          <h1 className="panel-title">{t.seo.songNotFound}</h1>
          <p className="meta">
            {t.song.notFoundBody} <Link to="/charts">{t.song.backToList}</Link>
          </p>
        </section>
      </main>
    </>
  );
}

/** Up to `limit` other songs, starting after `song` in catalog order so neighbouring pages link to different ones. */
function related(song: CatalogSong, match: (other: CatalogSong) => boolean, limit = 8) {
  const start = catalogSongs.indexOf(song);
  return [...catalogSongs.slice(start + 1), ...catalogSongs.slice(0, start)]
    .filter(match)
    .slice(0, limit);
}

function SongLinks({ heading, songs }: { heading: string; songs: CatalogSong[] }) {
  if (!songs.length) return null;
  return (
    <section className="panel song-links">
      <div className="panel-head">
        <h2 className="panel-title">{heading}</h2>
      </div>
      <ul>
        {songs.map((other) => (
          <li key={other.id}>
            <Link to="/charts/$id" params={{ id: other.id }}>
              <span className="record-title">{other.title}</span>
              <span className="record-artist">{other.artist}</span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Each of this song's charts: constant, charter and a link to its preview, plus the player's record on it once
 * a save is loaded. */
function SongCharts({ song }: { song: CatalogSong }) {
  const { loaded } = useSave();
  const t = useT();
  const ranking = loaded && calculateRanking(loaded.document);
  const bestIndex = new Map(
    ranking ? ranking.best.map((chart, index) => [chart.key, index + 1]) : [],
  );
  const records = ranking
    ? ranking.charts.filter((chart) => canonicalSongId(chart.songId) === song.id)
    : [];
  const columns = [
    t.song.difficulty,
    t.song.constant,
    t.song.charter,
    ...(ranking ? [t.song.score, t.song.acc, t.song.rank, "RKS"] : []),
    "",
  ];
  return (
    <section className="panel your-records">
      <div className="panel-head">
        <h2 className="panel-title">{ranking ? t.song.yourRecords : t.tabs.charts}</h2>
      </div>
      <div className="chart-stats-scroll">
        <table className="song-diff-table">
          <thead>
            <tr>
              {columns.map((name) => (
                <th key={name} scope="col">
                  {name || <span className="sr-only">{t.song.preview}</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LEVELS.map((level, levelIndex) => {
              if (song.constants[levelIndex] == null) return null;
              const record = records.find((chart) => chart.levelIndex === levelIndex);
              const best = record && bestIndex.get(record.key);
              return (
                <tr key={level}>
                  <td>
                    <Difficulty level={level} />
                  </td>
                  <td className="num">{song.constants[levelIndex]!.toFixed(1)}</td>
                  <td className="meta">{song.charters[levelIndex] ?? "-"}</td>
                  {ranking &&
                    (record ? (
                      <>
                        <td className="num record-score">{score7(record.score)}</td>
                        <td className="num">{record.accuracy.toFixed(2)}%</td>
                        <td>
                          <Rank score={record.score} fc={record.fc} />
                        </td>
                        <td className="num">
                          {record.rks.toFixed(2)}
                          {best && <span className="meta"> · {t.song.best(best)}</span>}
                        </td>
                      </>
                    ) : (
                      <td className="meta" colSpan={4}>
                        {t.song.notPlayed}
                      </td>
                    ))}
                  <td className="chart-links">
                    <Link
                      to="/charts/$id/play/$level"
                      params={{ id: song.id, level }}
                      className="link-button"
                    >
                      {t.song.preview}
                    </Link>
                    <Link
                      to="/charts/$id/plays/$level"
                      params={{ id: song.id, level }}
                      className="link-button"
                    >
                      {t.tabs.leaderboard}
                    </Link>
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

function SongPage() {
  const { id } = Route.useParams();
  const song = catalogSong(id)!; // the loader 404s unknown IDs
  const { stats } = Route.useLoaderData();
  const index = catalogSongs.findIndex((entry) => entry.id === song.id);
  const previous = catalogSongs[(index - 1 + catalogSongs.length) % catalogSongs.length]!;
  const next = catalogSongs[(index + 1) % catalogSongs.length]!;
  const sameChapter = related(song, (other) => other.chapter === song.chapter);
  const sameArtist = related(song, (other) => other.artist === song.artist);
  const navigate = useNavigate();
  const t = useT();
  // ← / → step through the catalog like the pager below, unless a field or a modified shortcut wants the key.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const step = { ArrowLeft: previous, ArrowRight: next }[event.key];
      const target = event.target as HTMLElement;
      if (
        !step ||
        event.defaultPrevented ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey
      )
        return;
      if (target.closest("input, textarea, select, [contenteditable], dialog[open]")) return;
      event.preventDefault();
      void navigate({ to: "/charts/$id", params: { id: step.id } });
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, previous, next]);
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <p className="meta breadcrumb">
          <Link to="/charts">{t.tabs.charts}</Link> /{" "}
          <Link to="/charts" search={{ chapter: song.chapter }}>
            {song.chapter}
          </Link>{" "}
          / {song.title}
        </p>
        {/* On wide screens two columns that scroll on their own: the song and its links to other songs on the left,
         * its charts, records and stats on the right. */}
        <div className="song-layout">
          <div className="song-main">
            <section className="panel song-detail">
              <div className="song-detail-media">
                <img
                  src={`/covers/${song.id}.avif`}
                  width={1024}
                  height={540}
                  alt={
                    song.illustrator
                      ? t.seo.coverAltBy(song.title, song.illustrator)
                      : t.seo.coverAlt(song.title)
                  }
                  decoding="async"
                />
              </div>
              <div className="song-detail-body">
                <h1 className="panel-title">{song.title}</h1>
                <p className="meta">
                  <Link to="/charts" search={{ q: song.artist }} className="artist-link">
                    {song.artist}
                  </Link>{" "}
                  ·{" "}
                  <Link to="/charts" search={{ chapter: song.chapter }} className="chapter-link">
                    {song.chapter}
                  </Link>
                </p>
                {song.illustrator && (
                  <p className="meta">{t.song.illustratedBy(song.illustrator)}</p>
                )}
              </div>
            </section>
            <SongLinks heading={t.song.moreFrom(song.chapter)} songs={sameChapter} />
            <SongLinks heading={t.song.moreBy(song.artist)} songs={sameArtist} />
          </div>
          <div className="song-side">
            <section className="song-scroll" aria-label={t.song.scrollLabel}>
              <SongCharts song={song} />
              {stats && (
                <section className="panel chart-stats">
                  <div className="panel-head">
                    <h2 className="panel-title">{t.song.chartStats}</h2>
                  </div>
                  <div className="chart-stats-scroll">
                    <table className="song-diff-table">
                      <thead>
                        <tr>
                          <th scope="col">
                            <span className="sr-only">{t.song.metric}</span>
                          </th>
                          {LEVELS.map(
                            (level, levelIndex) =>
                              song.constants[levelIndex] != null && (
                                <th key={level} scope="col">
                                  <Difficulty level={level} />
                                </th>
                              ),
                          )}
                        </tr>
                      </thead>
                      <tbody>
                        {STAT_ROWS.map(([key, format, help]) => (
                          <tr key={key}>
                            <td className="meta">
                              {t.song.stats[key]}
                              {help && (
                                <abbr
                                  className="stat-help"
                                  title={t.song.help[key as keyof Messages["song"]["help"]]}
                                >
                                  ?
                                </abbr>
                              )}
                            </td>
                            {LEVELS.map(
                              (level, levelIndex) =>
                                song.constants[levelIndex] != null && (
                                  <td key={level} className="num">
                                    {stats[levelIndex] ? format(stats[levelIndex]!, t) : "-"}
                                  </td>
                                ),
                            )}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
              )}
            </section>
            {/* Outside the scroll area so it stays put from one song to the next (← and → follow it too). */}
            <nav className="song-pager" aria-label={t.song.adjacent}>
              <Link
                to="/charts/$id"
                params={{ id: previous.id }}
                className="arrow-row import-option song-pager-prev"
              >
                <span className="arrow-chip">
                  <Arrow />
                </span>
                <span>
                  <span className="import-description">{t.song.previous}</span>
                  <strong>{previous.title}</strong>
                </span>
              </Link>
              <Link
                to="/charts/$id"
                params={{ id: next.id }}
                className="arrow-row import-option song-pager-next"
              >
                <span>
                  <span className="import-description">{t.song.next}</span>
                  <strong>{next.title}</strong>
                </span>
                <span className="arrow-chip">
                  <Arrow />
                </span>
              </Link>
            </nav>
          </div>
        </div>
      </main>
    </>
  );
}
