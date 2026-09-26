import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { catalogSong } from "../catalog";
import type { SaveDocumentV1 } from "../document";
import { calculateRanking, chartRks, projectAccuracy } from "../metrics";
import { LEVELS } from "../modules";
import { Difficulty, DifficultyFilter, Rank, score7 } from "./primitives";

function rowsFor(document: SaveDocumentV1) {
  return document.songs.flatMap((song) =>
    song.levels.flatMap((record, levelIndex) => {
      if (!record) return [];
      const metadata = catalogSong(song.songId);
      const constant = metadata?.constants[levelIndex];
      return [
        {
          songId: song.songId,
          title: metadata?.title ?? song.songId,
          artist: metadata?.artist ?? "unknown",
          levelIndex,
          score: record.score,
          accuracy: record.accuracy,
          fc: Boolean((song.fc >> levelIndex) & 1),
          constant,
          rks: constant == null ? undefined : chartRks(record.accuracy, constant),
        },
      ];
    }),
  );
}

export function ChartTable({ document }: { document: SaveDocumentV1 }) {
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [sort, setSort] = useState("rks");
  const [status, setStatus] = useState("");
  const ranking = calculateRanking(document);
  const inBest = new Set(ranking.best.map((record) => record.key));
  const inPhi = new Set(ranking.phi.map((record) => record.key));
  const unfiltered = sort === "rks" && !search.trim() && difficulty === "" && status === "";
  const all = rowsFor(document);
  const query = search.trim().toLocaleLowerCase();
  const rows = all.filter(
    (row) =>
      (!query || `${row.title} ${row.artist} ${row.songId}`.toLocaleLowerCase().includes(query)) &&
      (difficulty === "" || row.levelIndex === Number(difficulty)) &&
      (status === "" ||
        (status === "no-fc" && !row.fc) ||
        (status === "fc" && row.fc && row.accuracy < 100) ||
        (status === "phi" && row.accuracy >= 100)),
  );
  // How much the overall RKS would rise if this chart were All Perfect; only computed while sorting by it.
  const gain = new Map(
    sort === "gain"
      ? rows.map((row) => {
          const key = `${row.songId}:${LEVELS[row.levelIndex]}`;
          const known = row.constant != null && row.accuracy < 100;
          return [
            key,
            known ? projectAccuracy(ranking, key, 100).rankingScore - ranking.rankingScore : 0,
          ];
        })
      : [],
  );
  const value = (row: (typeof rows)[number]) =>
    sort === "gain"
      ? gain.get(`${row.songId}:${LEVELS[row.levelIndex]}`)
      : row[sort as "accuracy" | "score" | "rks" | "constant"];
  rows.sort(
    sort === "title"
      ? (a, b) => a.title.localeCompare(b.title) || a.levelIndex - b.levelIndex
      : (a, b) => Number(value(b) ?? -1) - Number(value(a) ?? -1) || a.title.localeCompare(b.title),
  );
  return (
    <section id="charts" className="panel records min-w-0" aria-labelledby="records-heading">
      <div className="panel-head">
        <h2 id="records-heading" className="panel-title">
          Chart Records
        </h2>
        <span className="panel-count">{all.length} records</span>
      </div>
      <div className="filters">
        <input
          className="field search-field"
          type="search"
          placeholder="Search song or artist"
          aria-label="Search charts"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <DifficultyFilter value={difficulty} onChange={setDifficulty} />
        <label className="select">
          <span className="select-label">Status</span>
          <select
            className="select-field"
            aria-label="Filter by clear status"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">Any</option>
            <option value="no-fc">Not Full Combo</option>
            <option value="fc">Full Combo, not φ</option>
            <option value="phi">All Perfect (φ)</option>
          </select>
        </label>
        <label className="select">
          <span className="select-label">Sort by</span>
          <select
            className="select-field"
            aria-label="Sort charts"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="title">Title</option>
            <option value="accuracy">Accuracy</option>
            <option value="score">Score</option>
            <option value="rks">RKS</option>
            <option value="constant">Constant</option>
            <option value="gain">RKS gain if φ</option>
          </select>
        </label>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to focus this region to scroll it. */}
      <section className="table-scroll" tabIndex={0} aria-label="Scrollable chart records">
        <table>
          <caption className="sr-only">
            {rows.length} of {all.length} chart records
          </caption>
          <thead>
            <tr>
              {["#", "Song", "Diff", "Const", "Score", "Acc", "Rank", "RKS"].map((name) => (
                <th key={name} scope="col">
                  {name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((record, index) => {
              const key = `${record.songId}:${LEVELS[record.levelIndex]}`;
              return (
                <tr
                  key={key}
                  className={
                    [
                      inBest.has(key) ? "in-best" : "",
                      unfiltered && index === ranking.best.length ? "b27-edge" : "",
                    ]
                      .join(" ")
                      .trim() || undefined
                  }
                >
                  <td className="record-index">{index + 1}</td>
                  <td>
                    <div className="record-song">
                      <Link
                        to="/charts/$id"
                        params={{ id: record.songId }}
                        className="record-title record-pick"
                        title="View this chart's details"
                      >
                        {record.title}
                      </Link>
                      <span className="record-artist">{record.artist}</span>
                    </div>
                  </td>
                  <td>
                    <Difficulty level={LEVELS[record.levelIndex]!} />
                  </td>
                  <td className="num">{record.constant?.toFixed(1) ?? "?"}</td>
                  <td className="num record-score">{score7(record.score)}</td>
                  <td className="num">{record.accuracy.toFixed(2)}%</td>
                  <td>
                    <span className="record-rank">
                      <Rank score={record.score} fc={record.fc} />
                      {inPhi.has(key) && (
                        <span className="phi-slot" title="Counted in one of your Phi slots">
                          φ slot
                        </span>
                      )}
                    </span>
                  </td>
                  <td className="num record-rks">
                    {record.rks?.toFixed(4) ?? "—"}
                    {sort === "gain" && (
                      <span className="record-gain" title="Overall RKS gained by an All Perfect">
                        +{(gain.get(key) ?? 0).toFixed(4)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={8} className="meta empty-row">
                  No chart records match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
