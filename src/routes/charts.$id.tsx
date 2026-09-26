import { createFileRoute, Link, notFound, useNavigate } from "@tanstack/react-router";
import { type CatalogSong, canonicalSongId, catalogSong, catalogSongs } from "../catalog";
import { type ChartStats, getSongDetails } from "../chartStats";
import { Arrow } from "../components/arrow";
import { SiteHeader } from "../components/chrome";
import { Difficulty, Rank, score7 } from "../components/primitives";
import { calculateRanking } from "../metrics";
import { LEVELS } from "../modules";
import { useSave } from "../save-context";
import { breadcrumbs, jsonLd, pageMeta, SITE } from "../seo";

function mmss(totalSeconds: number) {
  const m = Math.floor(totalSeconds / 60);
  const s = Math.round(totalSeconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Row label + formatter (+ optional "(?)" explanation) for the chart-stats table; every field comes from the game's own chart files (see scripts/build-chart-stats.ts). */
const STAT_ROWS: [string, (s: ChartStats) => string, string?][] = [
  ["Notes", (s) => String(s.notes)],
  ["Tap", (s) => String(s.tap)],
  ["Drag", (s) => String(s.drag)],
  ["Hold", (s) => String(s.hold)],
  ["Flick", (s) => String(s.flick)],
  ["Chart length", (s) => mmss(s.lengthSec)],
  [
    "Avg. density",
    (s) => `${s.avgNps.toFixed(1)}/s`,
    "Average notes per second across the whole chart.",
  ],
  [
    "Peak density",
    (s) => `${s.peakNps}/s`,
    "The most notes packed into any single one-second window of the chart.",
  ],
  [
    "Largest chord",
    (s) => `${s.maxChord} note${s.maxChord === 1 ? "" : "s"}`,
    "The most notes the chart ever asks you to hit at the exact same instant.",
  ],
  [
    "Chords (2+ notes)",
    (s) => String(s.chordCount),
    "How many moments have two or more notes landing within 10ms of each other.",
  ],
  [
    "Hold time",
    (s) =>
      `${mmss(s.holdSec)} (${s.lengthSec > 0 ? Math.round((s.holdSec / s.lengthSec) * 100) : 0}%)`,
    "Total time spent holding a note, and what share of the chart's length that is.",
  ],
  [
    "Longest gap",
    (s) => `${s.longestGapSec.toFixed(1)}s`,
    "The longest stretch anywhere in the chart with no note to hit, the biggest pause.",
  ],
  [
    "Notes / line",
    (s) => (s.notes / s.lines).toFixed(1),
    "Average notes per judge line: low means choreography is spread across many lines, high means it's concentrated on a few.",
  ],
  ["BPM", (s) => (s.bpmMin === s.bpmMax ? String(s.bpm) : `${s.bpmMin}–${s.bpmMax}`)],
  [
    "Scroll speed",
    (s) => `${s.speedMin}×–${s.speedMax}×`,
    "How fast notes fall towards the judge line, as a multiplier. Higher means less reaction time.",
  ],
  [
    "Speed changes",
    (s) => String(s.speedChanges),
    "How many times the scroll speed changes during the chart.",
  ],
  [
    "Judge lines",
    (s) => String(s.lines),
    "The independent moving/rotating lines the chart's notes are attached to. More lines usually means more visual choreography.",
  ],
  [
    "Above / below",
    (s) => `${s.above} / ${s.below}`,
    "Notes attached to the upper vs. lower side of their judge line.",
  ],
  [
    "Motion events",
    (s) => String(s.motionEvents),
    "Combined count of line movement, rotation and disappearance keyframes: a rough proxy for how much the chart's visuals move.",
  ],
];

/** "a", "a and b", "a, b and c". */
function list(items: string[]) {
  return items.length < 3
    ? items.join(" and ")
    : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/**
 * A few natural sentences about a song for search snippets and link previews: who made it, where it's
 * from, which difficulties exist and who charted them, and what its hardest chart is like.
 */
function describe(song: CatalogSong, songStats: (ChartStats | null)[] | null): string {
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
      ? `, all charted by ${[...byCharter.keys()][0]}`
      : byCharter.size > 1
        ? `, charted by ${list([...byCharter].map(([name, charted]) => `${name} (${charted.join("/")})`))}`
        : "";
  const hardest = levels.at(-1);
  const stats = hardest && songStats?.[hardest.index];
  const bpm =
    stats && (stats.bpmMin === stats.bpmMax ? `${stats.bpm}` : `${stats.bpmMin}–${stats.bpmMax}`);
  return [
    `${song.title} is a Phigros song by ${song.artist}, from ${song.chapter}.`,
    `It has ${levels.length === 1 ? "one chart" : `${levels.length} charts`}: ${list(levels.map(({ level, constant }) => `${level} ${constant.toFixed(1)}`))}${charters}.`,
    stats &&
      `The ${hardest.level} chart packs ${stats.notes.toLocaleString("en")} notes into ${mmss(stats.lengthSec)} at ${bpm} BPM.`,
    song.illustrator && `Cover art by ${song.illustrator}.`,
  ]
    .filter(Boolean)
    .join(" ");
}

const songPath = (song: CatalogSong) => `/charts/${encodeURIComponent(song.id)}`;

export const Route = createFileRoute("/charts/$id")({
  loader: ({ params }) => {
    if (!catalogSong(params.id)) throw notFound(); // a real 404, not a 200 "not found" page
    return getSongDetails({ data: params.id });
  },
  head: ({ params, loaderData }) => {
    const song = catalogSong(params.id);
    if (!song)
      return {
        meta: [
          ...pageMeta({
            title: "Song Not Found",
            description: "This song isn't in the Phigros chart list.",
            path: "/charts",
          }),
          { name: "robots", content: "noindex" },
        ],
      };
    const title = `${song.title} — ${song.artist}`;
    const image = `${SITE}/covers/${encodeURIComponent(song.id)}.og.jpg`;
    return {
      meta: pageMeta({
        title,
        description: describe(song, loaderData?.stats ?? null),
        path: songPath(song),
        type: "music.song",
        themeColor: loaderData?.themeColor,
        image: {
          url: image,
          width: 1024,
          height: 540,
          alt: `Cover art for ${song.title}${song.illustrator ? ` by ${song.illustrator}` : ""}`,
        },
      }),
      links: [{ rel: "canonical", href: `${SITE}${songPath(song)}` }],
      scripts: [
        jsonLd({
          "@graph": [
            breadcrumbs([
              ["Phigros Tools", "/"],
              ["Charts", "/charts"],
              [song.title, songPath(song)],
            ]),
            {
              "@type": "MusicRecording",
              name: song.title,
              url: `${SITE}${songPath(song)}`,
              description: describe(song, loaderData?.stats ?? null),
              image,
              byArtist: { "@type": "MusicGroup", name: song.artist },
              ...(song.illustrator
                ? { contributor: { "@type": "Person", name: song.illustrator } }
                : {}),
              inAlbum: {
                "@type": "MusicAlbum",
                name: song.chapter,
                url: `${SITE}/charts?chapter=${encodeURIComponent(song.chapter)}`,
              },
            },
          ],
        }),
      ],
    };
  },
  notFoundComponent: () => (
    <>
      <SiteHeader />
      <main className="app-shell">
        <section className="panel">
          <h1 className="panel-title">Song Not Found</h1>
          <p className="meta">
            No song with this ID is in the catalog. <Link to="/charts">Back to the chart list</Link>
            .
          </p>
        </section>
      </main>
    </>
  ),
  component: SongPage,
});

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

/** With a save loaded: the player's record on each of this song's charts, and a way into the Overview's simulator. */
function YourRecords({ song }: { song: CatalogSong }) {
  const { loaded, setChartKey } = useSave();
  const navigate = useNavigate();
  if (!loaded) return null;
  const ranking = calculateRanking(loaded.document);
  const bestIndex = new Map(ranking.best.map((chart, index) => [chart.key, index + 1]));
  const records = ranking.charts.filter((chart) => canonicalSongId(chart.songId) === song.id);
  return (
    <section className="panel your-records">
      <div className="panel-head">
        <h2 className="panel-title">Your Records</h2>
      </div>
      <table className="song-diff-table">
        <thead>
          <tr>
            {["Difficulty", "Score", "Acc", "Rank", "RKS", ""].map((name) => (
              <th key={name} scope="col">
                {name || <span className="sr-only">Simulate</span>}
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
                {record ? (
                  <>
                    <td className="num record-score">{score7(record.score)}</td>
                    <td className="num">{record.accuracy.toFixed(2)}%</td>
                    <td>
                      <Rank score={record.score} fc={record.fc} />
                    </td>
                    <td className="num">
                      {record.rks.toFixed(2)}
                      {best && <span className="meta"> · Best #{best}</span>}
                    </td>
                  </>
                ) : (
                  <td className="meta" colSpan={4}>
                    Not played
                  </td>
                )}
                <td>
                  <button
                    type="button"
                    className="link-button"
                    onClick={() => {
                      setChartKey(record?.key ?? `${song.id}:${level}`);
                      void navigate({ to: "/" });
                    }}
                  >
                    Simulate
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
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
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <p className="meta breadcrumb">
          <Link to="/charts">Charts</Link> /{" "}
          <Link to="/charts" search={{ chapter: song.chapter }}>
            {song.chapter}
          </Link>{" "}
          / {song.title}
        </p>
        <section className="panel song-detail">
          <div className="song-detail-media">
            <img
              src={`/covers/${song.id}.avif`}
              width={1024}
              height={540}
              alt={`Cover art for ${song.title}${song.illustrator ? `, illustrated by ${song.illustrator}` : ""}`}
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
            {song.illustrator && <p className="meta">Illustrated by {song.illustrator}</p>}
            <table className="song-diff-table">
              <thead>
                <tr>
                  <th scope="col">Difficulty</th>
                  <th scope="col">Constant</th>
                  <th scope="col">Charter</th>
                </tr>
              </thead>
              <tbody>
                {LEVELS.map(
                  (level, levelIndex) =>
                    song.constants[levelIndex] != null && (
                      <tr key={level}>
                        <td>
                          <Difficulty level={level} />
                        </td>
                        <td className="num">{song.constants[levelIndex]!.toFixed(1)}</td>
                        <td className="meta">{song.charters[levelIndex] ?? "-"}</td>
                      </tr>
                    ),
                )}
              </tbody>
            </table>
          </div>
        </section>
        <YourRecords song={song} />
        {stats && (
          <section className="panel chart-stats">
            <div className="panel-head">
              <h2 className="panel-title">Chart Stats</h2>
            </div>
            <div className="chart-stats-scroll">
              <table className="song-diff-table">
                <thead>
                  <tr>
                    <th scope="col">
                      <span className="sr-only">Metric</span>
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
                  {STAT_ROWS.map(([label, format, help]) => (
                    <tr key={label}>
                      <td className="meta">
                        {label}
                        {help && (
                          <abbr className="stat-help" title={help}>
                            ?
                          </abbr>
                        )}
                      </td>
                      {LEVELS.map(
                        (level, levelIndex) =>
                          song.constants[levelIndex] != null && (
                            <td key={level} className="num">
                              {stats[levelIndex] ? format(stats[levelIndex]!) : "-"}
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
        <SongLinks heading={`More From ${song.chapter}`} songs={sameChapter} />
        <SongLinks heading={`More By ${song.artist}`} songs={sameArtist} />
        <nav className="song-pager" aria-label="Adjacent songs">
          <Link
            to="/charts/$id"
            params={{ id: previous.id }}
            className="arrow-row import-option song-pager-prev"
          >
            <span className="arrow-chip">
              <Arrow />
            </span>
            <span>
              <span className="import-description">Previous</span>
              <strong>{previous.title}</strong>
            </span>
          </Link>
          <Link
            to="/charts/$id"
            params={{ id: next.id }}
            className="arrow-row import-option song-pager-next"
          >
            <span>
              <span className="import-description">Next</span>
              <strong>{next.title}</strong>
            </span>
            <span className="arrow-chip">
              <Arrow />
            </span>
          </Link>
        </nav>
      </main>
    </>
  );
}
