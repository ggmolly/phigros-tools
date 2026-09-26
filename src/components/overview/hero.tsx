import { useState } from "react";
import { catalogChartTotals } from "../../catalog";
import type { SaveDocumentV1 } from "../../document";
import type { RankingResult } from "../../metrics";
import { countLevels, LEVELS } from "../../modules";
import { challengeRank, dataAmount, LevelStats, Stat } from "../primitives";
import { ShareCard } from "../share";

/** The RKS ribbon, overall totals, Challenge Mode rank, Data, self-intro and per-difficulty completion. */
export function Hero({
  ranking,
  document,
  playerName,
}: {
  ranking: RankingResult;
  document: SaveDocumentV1;
  playerName?: string;
}) {
  const songs = document.songs;
  const challenge = challengeRank(document.gameProgress.challengeModeRank);
  const data = dataAmount(document.gameProgress.money);
  const intro = document.profile?.intro.trim();
  const [statLevel, setStatLevel] = useState(ranking.best[0]?.levelIndex ?? 1);
  const counts = countLevels(songs);
  const total = songs.reduce((sum, song) => sum + song.levels.filter(Boolean).length, 0);
  const fcTotal = counts.reduce((sum, count) => sum + count.fc, 0);
  const apTotal = counts.reduce((sum, count) => sum + count.phi, 0);
  return (
    <section className="hero score-board" aria-labelledby="rks-heading">
      <div className="hero-art" aria-hidden="true" />
      <ShareCard
        ranking={ranking}
        songs={songs}
        playerName={playerName}
        avatar={document.profile?.avatar || document.summary?.avatar || ""}
      />
      <div className="hero-ribbon">
        <h1 id="rks-heading" className="hero-label">
          RKS
        </h1>
        <p className="ranking-number">{ranking.rankingScore.toFixed(3)}</p>
      </div>
      <div className="hero-stats">
        <Stat label="Played" value={total} />
        <Stat label="Full Combo" value={fcTotal} total={total} />
        <Stat label="All Perfect" value={apTotal} total={total} />
        {challenge && (
          <Stat
            className={`challenge challenge-${challenge.colour.toLowerCase()}`}
            label={`Challenge · ${challenge.colour}`}
            value={challenge.level}
          />
        )}
        <Stat label="Data" value={data.value} total={data.rest} />
      </div>
      {intro && <p className="hero-intro">{intro}</p>}
      <div className="stat-bar">
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset's default browser styling (border/padding) would need a reset; role="group" is valid ARIA for a button group. */}
        <div className="level-switch" role="group" aria-label="Difficulty for completion stats">
          {LEVELS.map((level, index) => (
            <button
              key={level}
              type="button"
              className="level-switch-option"
              aria-pressed={statLevel === index}
              onClick={() => setStatLevel(index)}
            >
              {level}
            </button>
          ))}
        </div>
        <LevelStats count={counts[statLevel]!} total={catalogChartTotals[statLevel]!} />
      </div>
    </section>
  );
}
