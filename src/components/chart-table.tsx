import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { catalogSong, searchFold } from "../catalog";
import type { SaveDocumentV1 } from "../document";
import { useFormat, useT } from "../i18n";
import { calculateRanking, chartRks, projectAccuracy } from "../metrics";
import { LEVELS } from "../modules";
import { Difficulty, DifficultyFilter, PhiSlot, Rank, score7 } from "./primitives";

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
          romanized: metadata?.romanized ?? [],
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
  const t = useT();
  const format = useFormat();
  const [search, setSearch] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [sort, setSort] = useState("rks");
  const [status, setStatus] = useState("");
  const ranking = calculateRanking(document);
  const inBest = new Set(ranking.best.map((record) => record.key));
  const phiSlot = new Map(ranking.phi.map((record, index) => [record.key, index]));
  const unfiltered = sort === "rks" && !search.trim() && difficulty === "" && status === "";
  const all = rowsFor(document);
  const query = searchFold(search);
  const rows = all.filter(
    (row) =>
      (!query || searchFold(row.title, row.artist, row.songId, ...row.romanized).includes(query)) &&
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
          {t.records.title}
        </h2>
        <span className="panel-count">
          {(all.length === 1 ? t.records.countOne : t.records.countMany)(all.length)}
        </span>
      </div>
      <div className="filters">
        <input
          className="field search-field"
          type="search"
          placeholder={t.records.searchPlaceholder}
          aria-label={t.records.searchLabel}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <DifficultyFilter value={difficulty} onChange={setDifficulty} />
        <label className="select">
          <span className="select-label">{t.records.status}</span>
          <select
            className="select-field"
            aria-label={t.records.statusLabel}
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            <option value="">{t.records.any}</option>
            <option value="no-fc">{t.records.notFc}</option>
            <option value="fc">{t.records.fcNotPhi}</option>
            <option value="phi">{t.records.phi}</option>
          </select>
        </label>
        <label className="select">
          <span className="select-label">{t.records.sortBy}</span>
          <select
            className="select-field"
            aria-label={t.records.sortLabel}
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="title">{t.records.sortTitle}</option>
            <option value="accuracy">{t.records.sortAccuracy}</option>
            <option value="score">{t.records.sortScore}</option>
            <option value="rks">RKS</option>
            <option value="constant">{t.records.sortConstant}</option>
            <option value="gain">{t.records.sortGain}</option>
          </select>
        </label>
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: keyboard users need to focus this region to scroll it. */}
      <section className="table-scroll" tabIndex={0} aria-label={t.records.scrollRegion}>
        <table>
          <caption className="sr-only">
            {t.records.caption(format.number(rows.length), format.number(all.length))}
          </caption>
          <thead>
            <tr>
              {[
                "#",
                t.records.colSong,
                t.records.colDiff,
                t.records.colConst,
                t.records.colScore,
                t.records.colAcc,
                t.records.colRank,
                "RKS",
              ].map((name) => (
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
                        title={t.common.viewChart}
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
                      {phiSlot.has(key) && <PhiSlot index={phiSlot.get(key)!} />}
                    </span>
                  </td>
                  <td className="num record-rks">
                    {record.rks?.toFixed(4) ?? "—"}
                    {sort === "gain" && (
                      <span className="record-gain" title={t.records.gainTitle}>
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
                  {t.records.empty}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </section>
    </section>
  );
}
