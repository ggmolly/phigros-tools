import { useState } from "react";
import { catalogCompatible, catalogSong, unknownSongIds } from "../../catalog";
import type { SaveDocumentV1 } from "../../document";
import { blankChart, type ChartMetric, calculateRanking } from "../../metrics";
import { countLevels, LEVELS, type LevelName } from "../../modules";
import { useSave } from "../../save-context";
import { BestList } from "./best-list";
import { ChartDetail } from "./chart-detail";
import { Hero } from "./hero";
import { NextTarget } from "./next-target";

/** An empty record for a catalog chart the player hasn't played, so the simulator can project it from zero. */
function unplayedChart(key: string): ChartMetric | undefined {
  const split = key.lastIndexOf(":");
  const song = catalogSong(key.slice(0, split));
  const levelIndex = LEVELS.indexOf(key.slice(split + 1) as LevelName);
  const constant = song?.constants[levelIndex];
  return song && levelIndex >= 0 && constant != null
    ? blankChart(song, levelIndex, constant)
    : undefined;
}

/** The Overview tab's content: hero + Best list + accuracy simulator + Next Target. */
export function Overview({
  document,
  playerName,
}: {
  document: SaveDocumentV1;
  playerName?: string;
}) {
  const ranking = calculateRanking(document);
  const counts = countLevels(document.songs);
  const unknown = unknownSongIds(document.songs.map((song) => song.songId));
  const { chartKey, setChartKey } = useSave();
  const [accuracy, setAccuracy] = useState("100.00");
  const playedChart = ranking.charts.find((record) => record.key === chartKey);
  const unplayed = playedChart ? undefined : unplayedChart(chartKey);
  const chart = playedChart ?? unplayed ?? ranking.charts[0];
  function pick(key: string, nextAccuracy = "100.00") {
    setChartKey(key);
    setAccuracy(nextAccuracy);
  }

  return (
    <>
      {document.summary && JSON.stringify(counts) !== JSON.stringify(document.summary.counts) && (
        <p className="warning">Parsed chart counts differ from the server summary.</p>
      )}
      {!catalogCompatible(document.summary?.gameVersion) && (
        <p className="warning">
          Catalog game version differs from this save; derived RKS is not authoritative.
        </p>
      )}
      {unknown.length > 0 && (
        <p className="warning">
          {unknown.length} unknown catalog ID{unknown.length === 1 ? "" : "s"}: {unknown.join(", ")}
        </p>
      )}

      <Hero ranking={ranking} document={document} playerName={playerName} />

      {chart ? (
        <div className="select-screen">
          <BestList ranking={ranking} selectedKey={chart.key} onPick={pick} />
          <div className="detail-column">
            <ChartDetail
              ranking={ranking}
              chart={chart}
              unplayed={!!unplayed}
              accuracy={accuracy}
              onAccuracy={setAccuracy}
              onPick={pick}
            />
            <NextTarget ranking={ranking} onPick={pick} />
          </div>
        </div>
      ) : (
        <p className="panel meta">No chart records with known constants yet.</p>
      )}
    </>
  );
}
