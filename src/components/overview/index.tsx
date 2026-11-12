import { useState } from "react";
import { catalogCompatible, catalogSong, unknownSongIds } from "../../catalog";
import type { SaveDocumentV1 } from "../../document";
import { useT } from "../../i18n";
import { blankChart, type ChartMetric, calculateRanking } from "../../metrics";
import { countLevels, LEVELS, type LevelName } from "../../modules";
import type { PlayerProfile } from "../../plays";
import { useSave } from "../../save-context";
import { Card, RecentActivity, RecentPlays } from "../player";
import { RksHistory } from "../rks-history";
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

/** The player's card with the save's RKS and counts, as the game shows them, over the server's. */
function withSave(profile: PlayerProfile, document: SaveDocumentV1, rks: number): PlayerProfile {
  const counts = countLevels(document.songs);
  const sum = (key: "fc" | "phi") => counts.reduce((total, count) => total + count[key], 0);
  const cleared = document.songs.reduce(
    (total, song) => total + song.levels.filter(Boolean).length,
    0,
  );
  return { ...profile, rks, stats: { ...profile.stats, cleared, fc: sum("fc"), phi: sum("phi") } };
}

/**
 * The Overview tab's content: hero + Best list + accuracy simulator + Next Target. A Phigros++ player's public profile
 * goes around it: their card in place of the hero, their RKS history, then their recent activity and plays.
 */
export function Overview({
  document,
  playerName,
  profile,
}: {
  document: SaveDocumentV1;
  playerName?: string;
  profile?: PlayerProfile;
}) {
  const t = useT();
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
        <p className="warning">{t.overview.countsDiffer}</p>
      )}
      {!catalogCompatible(document.summary?.gameVersion) && (
        <p className="warning">{t.overview.catalogDiffers}</p>
      )}
      {unknown.length > 0 && (
        <p className="warning">
          {(unknown.length === 1 ? t.overview.unknownIdOne : t.overview.unknownIdMany)(
            unknown.length,
            unknown.join(", "),
          )}
        </p>
      )}

      {profile ? (
        <>
          <Card profile={withSave(profile, document, ranking.rankingScore)} />
          <RksHistory history={profile.history} />
        </>
      ) : (
        <Hero ranking={ranking} document={document} playerName={playerName} />
      )}

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
        <p className="panel meta">{t.overview.noCharts}</p>
      )}
      {profile && (
        <>
          <RecentActivity profile={profile} />
          <RecentPlays profile={profile} />
        </>
      )}
    </>
  );
}
