import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import {
  canonicalChapter,
  catalogChartTotals,
  catalogManifest,
  catalogSongs,
  chapterSearchText,
  searchFold,
} from "../catalog";
import { SiteHeader } from "../components/chrome";
import { Difficulty, DifficultyFilter } from "../components/primitives";
import { useFormat, useT } from "../i18n";
import { LEVELS } from "../modules";
import { breadcrumbs, chartsImage, headT, jsonLd, localeUrl, pageLinks, pageMeta } from "../seo";

const CHAPTERS = [...new Set(catalogSongs.map((song) => song.chapter))].sort();
const CHART_TOTAL = catalogChartTotals.reduce((sum, total) => sum + total, 0);

export const Route = createFileRoute("/charts/")({
  // Filters live in the URL, so song pages and artist names can link straight to a filtered list.
  validateSearch: (
    search: Record<string, unknown>,
  ): { q?: string; chapter?: string; view?: "gallery" } => ({
    ...(search.view === "gallery" ? { view: "gallery" as const } : {}),
    ...(typeof search.q === "string" && search.q ? { q: search.q.slice(0, 100) } : {}),
    ...(typeof search.chapter === "string" && CHAPTERS.includes(canonicalChapter(search.chapter))
      ? { chapter: canonicalChapter(search.chapter) }
      : {}),
  }),
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: pageMeta({
        title: t.seo.chartsTitle,
        description: t.seo.chartsDescription(
          CHART_TOTAL,
          catalogSongs.length,
          CHAPTERS.length,
          String(catalogManifest.gameVersion),
        ),
        path: "/charts",
        locale,
        image: chartsImage(locale),
      }),
      links: pageLinks("/charts", locale),
      scripts: [
        jsonLd({
          "@graph": [
            breadcrumbs(
              [
                ["Phigros Tools", "/"],
                [t.tabs.charts, "/charts"],
              ],
              locale,
            ),
            {
              "@type": "ItemList",
              name: t.seo.songList,
              itemListElement: catalogSongs.map((song, index) => ({
                "@type": "ListItem",
                position: index + 1,
                url: localeUrl(`/charts/${encodeURIComponent(song.id)}`, locale),
                name: song.title,
              })),
            },
          ],
        }),
      ],
    };
  },
  component: ChartsPage,
});

function ChartsPage() {
  const { q: search = "", chapter = "", view } = Route.useSearch();
  const navigate = useNavigate({ from: Route.fullPath });
  const setFilter = (key: "q" | "chapter" | "view", value: string) =>
    void navigate({ search: (prev) => ({ ...prev, [key]: value || undefined }), replace: true });
  const [difficulty, setDifficulty] = useState("");
  const t = useT();
  const format = useFormat();
  const query = searchFold(search);
  const rows = catalogSongs.filter(
    (song) =>
      (!query ||
        searchFold(
          song.title,
          song.artist,
          song.illustrator,
          chapterSearchText(song.chapter),
          ...(song.romanized ?? []),
        ).includes(query)) &&
      (!chapter || song.chapter === chapter) &&
      (difficulty === "" || song.constants[Number(difficulty)] != null),
  );
  const count = t.charts.count(format.number(rows.length), format.number(catalogSongs.length));
  return (
    <>
      <SiteHeader />
      <main className="app-shell">
        <section className="panel min-w-0">
          <div className="panel-head">
            <h1 className="panel-title">{t.seo.chartsTitle}</h1>
            <span className="panel-count">{count}</span>
          </div>
          <div className="filters">
            <input
              className="field search-field"
              type="search"
              placeholder={t.charts.searchPlaceholder}
              aria-label={t.charts.searchLabel}
              value={search}
              onChange={(e) => setFilter("q", e.target.value)}
            />
            <label className="select">
              <span className="select-label">{t.charts.chapter}</span>
              <select
                className="select-field"
                aria-label={t.charts.chapterFilter}
                value={chapter}
                onChange={(e) => setFilter("chapter", e.target.value)}
              >
                <option value="">{t.charts.allChapters}</option>
                {CHAPTERS.map((name) => (
                  <option key={name} value={name}>
                    {name}
                  </option>
                ))}
              </select>
            </label>
            <DifficultyFilter value={difficulty} onChange={setDifficulty} />
            {/* biome-ignore lint/a11y/useSemanticElements: same button group as DifficultyFilter. */}
            <div className="seg" role="group" aria-label={t.charts.view}>
              {(["", "gallery"] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="seg-option"
                  aria-pressed={(view ?? "") === option}
                  onClick={() => setFilter("view", option)}
                >
                  {option ? t.charts.gallery : t.charts.list}
                </button>
              ))}
            </div>
          </div>
          {view === "gallery" ? (
            <ul className="gallery" aria-label={t.charts.covers}>
              {rows.map((song) => (
                <li key={song.id}>
                  <Link to="/charts/$id" params={{ id: song.id }} className="gallery-card">
                    <img
                      src={`/covers/${song.id}.thumb.avif`}
                      srcSet={`/covers/${song.id}.thumb.avif 256w, /covers/${song.id}.avif 1024w`}
                      sizes="(max-width: 640px) 50vw, 240px"
                      width={256}
                      height={135}
                      loading="lazy"
                      decoding="async"
                      alt=""
                    />
                    <span className="gallery-info">
                      <span className="gallery-title">{song.title}</span>
                      <span className="gallery-line">{song.artist}</span>
                      {song.illustrator && (
                        <span className="gallery-line">
                          {t.charts.illustration(song.illustrator)}
                        </span>
                      )}
                      {LEVELS.map(
                        (level, index) =>
                          song.charters[index] && (
                            <span key={level} className="gallery-line">
                              <Difficulty level={level} /> {song.charters[index]}
                            </span>
                          ),
                      )}
                    </span>
                  </Link>
                </li>
              ))}
              {rows.length === 0 && <li className="meta empty-row">{t.charts.empty}</li>}
            </ul>
          ) : (
            <>
              {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to focus this region to scroll it. */}
              <section className="table-scroll" tabIndex={0} aria-label={t.charts.scrollable}>
                <table>
                  <caption className="sr-only">{count}</caption>
                  <thead>
                    <tr>
                      {["", t.charts.song, t.charts.chapter, ...LEVELS].map((name) => (
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
                              title={t.charts.songsBy(song.artist)}
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
                          {t.charts.empty}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </section>
      </main>
    </>
  );
}
