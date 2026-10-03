import { useState } from "react";
import { catalogChartTotals } from "../../catalog";
import type { SaveDocumentV1 } from "../../document";
import type { RankingResult } from "../../metrics";
import { countLevels, LEVELS } from "../../modules";
import { Avatar, challengeRank, dataAmount, LevelStats, Stat } from "../primitives";
import { ShareCard } from "../share";

/** The in-game profile strip (avatar, name, RKS tag, Challenge Mode badge), overall totals, self-intro and
 * per-difficulty completion. */
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
  const avatar = document.profile?.avatar || document.summary?.avatar || "";
  const [statLevel, setStatLevel] = useState(ranking.best[0]?.levelIndex ?? 1);
  const counts = countLevels(songs);
  const total = songs.reduce((sum, song) => sum + song.levels.filter(Boolean).length, 0);
  const fcTotal = counts.reduce((sum, count) => sum + count.fc, 0);
  const apTotal = counts.reduce((sum, count) => sum + count.phi, 0);
  return (
    <section className="hero" aria-labelledby="hero-name">
      <ShareCard ranking={ranking} songs={songs} playerName={playerName} avatar={avatar} />
      <div className="hero-id">
        <Avatar className="hero-avatar" name={avatar} />
        <h1 id="hero-name" className="hero-name">
          <span className="hero-name-text">{playerName || "Local save"}</span>
        </h1>
        <p className="hero-rks">
          <span className="hero-rks-label">RKS</span>
          <span className="ranking-number">{ranking.rankingScore.toFixed(3)}</span>
        </p>
        {challenge && (
          <p
            className={`challenge-badge challenge-${challenge.colour.toLowerCase()}`}
            title={`Challenge Mode: ${challenge.colour} ${challenge.level}`}
          >
            <span className="sr-only">Challenge Mode: {challenge.colour} </span>
            {challenge.level}
          </p>
        )}
      </div>
      <div className="hero-stats">
        <Stat label="Played" value={total} />
        <Stat label="Full Combo" value={fcTotal} total={total} />
        <Stat label="Phi" value={apTotal} total={total} />
        <Stat label="Data" value={data.value} total={data.unit} />
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
