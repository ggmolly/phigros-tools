import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { catalogChartTotals, catalogManifest, catalogSongs } from "../catalog";
import { SiteHeader } from "../components/chrome";
import { Difficulty, DifficultyFilter } from "../components/primitives";
import { LEVELS } from "../modules";
import { breadcrumbs, CHARTS_IMAGE, jsonLd, pageMeta, SITE } from "../seo";

const CHAPTERS = [...new Set(catalogSongs.map((song) => song.chapter))].sort();
const TITLE = "Chart & Difficulty List";
const DESCRIPTION = `Every Phigros chart and its difficulty constant: ${catalogChartTotals.reduce((sum, total) => sum + total, 0)} EZ, HD, IN and AT charts from ${catalogSongs.length} songs across ${CHAPTERS.length} chapters, with charters and illustrators (game version ${catalogManifest.gameVersion}).`;

export const Route = createFileRoute("/charts/")({
  // Filters live in the URL, so song pages and artist names can link straight to a filtered list.
  validateSearch: (search: Record<string, unknown>): { q?: string; chapter?: string } => ({
    ...(typeof search.q === "string" && search.q ? { q: search.q.slice(0, 100) } : {}),
    ...(typeof search.chapter === "string" && CHAPTERS.includes(search.chapter)
      ? { chapter: search.chapter }
      : {}),
  }),
  head: () => ({
    meta: pageMeta({
      title: TITLE,
      description: DESCRIPTION,
      path: "/charts",
      image: CHARTS_IMAGE,
    }),
    links: [{ rel: "canonical", href: `${SITE}/charts` }],
    scripts: [
      jsonLd({
        "@graph": [
          breadcrumbs([
            ["Phigros Tools", "/"],
            ["Charts", "/charts"],
          ]),
          {
            "@type": "ItemList",
            name: "Phigros songs",
            itemListElement: catalogSongs.map((song, index) => ({
              "@type": "ListItem",
              position: index + 1,
              url: `${SITE}/charts/${encodeURIComponent(song.id)}`,
              name: song.title,
            })),
          },
        ],
      }),
    ],
  }),
  component: ChartsPage,
});

function ChartsPage() {
  const { q: search = "", chapter = "" } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setFilter = (key: "q" | "chapter", value: string) =>
    void navigate({ search: (prev) => ({ ...prev, [key]: value || undefined }), replace: true });
  const [difficulty, setDifficulty] = useState("");
  const query = search.trim().toLocaleLowerCase();
  const rows = catalogSongs.filter(
    (song) =>
      (!query ||
        `${song.title} ${song.artist} ${song.illustrator ?? ""}`
          .toLocaleLowerCase()
          .includes(query)) &&
      (!chapter || song.chapter === chapter) &&
      (difficulty === "" || song.constants[Number(difficulty)] != null),
  );
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <section className="panel min-w-0">
          <div className="panel-head">
            <h1 className="panel-title">Chart & Difficulty List</h1>
            <span className="panel-count">
              {rows.length} of {catalogSongs.length} songs
            </span>
          </div>
          <div className="filters">
            <input
              className="field search-field"
              type="search"
              placeholder="Search title, artist or illustrator"
              aria-label="Search songs"
              value={search}
              onChange={(e) => setFilter("q", e.target.value)}
            />
            <label className="select">
              <span className="select-label">Chapter</span>
              <select
                className="select-field"
                aria-label="Filter by chapter"
                value={chapter}
                onChange={(e) => setFilter("chapter", e.target.value)}
              >
                <option value="">All chapters</option>
                {CHAPTERS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <DifficultyFilter value={difficulty} onChange={setDifficulty} />
          </div>
          {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to focus this region to scroll it. */}
          <section className="table-scroll" tabIndex={0} aria-label="Scrollable chart list">
            <table>
              <caption className="sr-only">
                {rows.length} of {catalogSongs.length} songs
              </caption>
              <thead>
                <tr>
                  {["", "Song", "Chapter", "EZ", "HD", "IN", "AT"].map((name) => (
                    <th key={name} scope="col">
                      {name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((song) => (
                  <tr key={song.id}>
                    <td>
                      <img
                        className="song-thumb"
                        src={`/covers/${song.id}.thumb.avif`}
                        width={48}
                        height={27}
                        loading="lazy"
                        decoding="async"
                        alt=""
                      />
                    </td>
                    <td>
                      <div className="record-song">
                        <Link
                          to="/charts/$id"
                          params={{ id: song.id }}
                          className="record-title record-pick"
                        >
                          {song.title}
                        </Link>
                        <Link
                          to="/charts"
                          search={{ q: song.artist }}
                          className="record-artist artist-link"
                          title={`Show songs by ${song.artist}`}
                        >
                          {song.artist}
                        </Link>
                      </div>
                    </td>
                    <td className="meta">
                      <Link
                        to="/charts"
                        search={{ chapter: song.chapter }}
                        className="chapter-link"
                      >
                        {song.chapter}
                      </Link>
                    </td>
                    {LEVELS.map((level, index) => (
                      <td key={level} className="num">
                        {song.constants[index] != null ? (
                          <>
                            <Difficulty level={level} /> {song.constants[index]!.toFixed(1)}
                          </>
                        ) : (
                          "-"
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
                {rows.length === 0 && (
                  <tr>
                    <td colSpan={7} className="meta empty-row">
                      No songs match these filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </section>
        </section>
      </main>
    </>
  );
}
