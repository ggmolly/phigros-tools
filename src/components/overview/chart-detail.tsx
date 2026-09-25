import { Link } from "@tanstack/react-router";
import type { CSSProperties } from "react";
import { catalogSong } from "../../catalog";
import { type ChartMetric, projectAccuracy, type RankingResult } from "../../metrics";
import { LEVELS } from "../../modules";
import { Rank, score7, signed } from "../primitives";

const MIN_ACCURACY = 70; // chart RKS is zero below this

function AccuracySlider({ value, onChange }: { value: number; onChange: (value: string) => void }) {
  const clamped = Math.min(100, Math.max(MIN_ACCURACY, value));
  const set = (next: number) =>
    onChange(Math.min(100, Math.max(MIN_ACCURACY, Math.round(next * 100) / 100)).toFixed(2));
  return (
    <div className="stepper">
      <button
        type="button"
        className="step"
        aria-label="Lower target accuracy by 0.1%"
        onClick={() => set(clamped - 0.1)}
      >
        −
      </button>
      <div
        className="slider"
        style={{ "--p": (clamped - MIN_ACCURACY) / (100 - MIN_ACCURACY) } as CSSProperties}
      >
        <input
          type="range"
          min={MIN_ACCURACY}
          max={100}
          step={0.01}
          value={clamped}
          aria-label="Target accuracy slider"
          onChange={(e) => set(Number(e.target.value))}
        />
        <span className="slider-fill" aria-hidden="true" />
        <span className="slider-thumb" aria-hidden="true" />
      </div>
      <button
        type="button"
        className="step"
        aria-label="Raise target accuracy by 0.1%"
        onClick={() => set(clamped + 0.1)}
      >
        +
      </button>
    </div>
  );
}

/** The selected chart: its record, the song's other difficulties, and the accuracy simulator. */
export function ChartDetail({
  ranking,
  chart,
  unplayed,
  accuracy,
  onAccuracy,
  onPick,
}: {
  ranking: RankingResult;
  chart: ChartMetric;
  /** Not in the save yet: `ranking` doesn't contain it, so the projection adds it. */
  unplayed: boolean;
  accuracy: string;
  onAccuracy: (value: string) => void;
  onPick: (key: string) => void;
}) {
  const validAccuracy = accuracy !== "" && Number(accuracy) >= 0 && Number(accuracy) <= 100;
  const next = validAccuracy
    ? projectAccuracy(
        unplayed ? { ...ranking, charts: [...ranking.charts, chart] } : ranking,
        chart.key,
        Number(accuracy),
      )
    : undefined;
  const projected = next?.charts.find((record) => record.key === chart.key);
  const bestIndex = ranking.best.findIndex((record) => record.key === chart.key);
  const phiIndex = ranking.phi.findIndex((record) => record.key === chart.key);
  const songLevels = (catalogSong(chart.songId)?.constants ?? []).flatMap((constant, levelIndex) =>
    constant == null
      ? []
      : [
          {
            constant,
            levelIndex,
            record: ranking.charts.find(
              (record) => record.songId === chart.songId && record.levelIndex === levelIndex,
            ),
          },
        ],
  );
  return (
    <section className="panel chart-detail" aria-labelledby="detail-title">
      <p className="detail-kicker">
        {unplayed
          ? "Not played yet"
          : bestIndex >= 0
            ? `Best #${bestIndex + 1}`
            : `Outside Best ${ranking.best.length}`}
        {phiIndex >= 0 && <span className="phi-slot">φ slot {phiIndex + 1}</span>}
      </p>
      <h2 id="detail-title" className="detail-title">
        <Link to="/charts/$id" params={{ id: chart.songId }} title="View this chart's details">
          {chart.title}
        </Link>
      </h2>
      <p className="detail-artist">
        <Link to="/charts" search={{ q: chart.artist }} className="artist-link" title={`Show songs by ${chart.artist}`}>
          {chart.artist}
        </Link>
      </p>
      <div className="score-bar">
        {/* biome-ignore lint/a11y/useSemanticElements: a fieldset's default browser styling (border/padding) would need a reset; role="group" is valid ARIA for a button group. */}
        <div className="level-picker" role="group" aria-label="Difficulty">
          {songLevels.map(({ constant, levelIndex, record }) => (
            <button
              key={levelIndex}
              type="button"
              className={`level-choice level-${LEVELS[levelIndex]!.toLowerCase()}${record ? "" : " unplayed"}`}
              aria-pressed={levelIndex === chart.levelIndex}
              title={`${LEVELS[levelIndex]} ${constant.toFixed(1)}${record ? "" : " · not played yet"}`}
              onClick={() => onPick(record?.key ?? `${chart.songId}:${LEVELS[levelIndex]}`)}
            >
              <span className="level-number">{Math.floor(constant)}</span>
              <span className="level-name">{LEVELS[levelIndex]}</span>
            </button>
          ))}
        </div>
        <p className={`score-value${unplayed ? " muted" : ""}`}>{score7(chart.score)}</p>
        <p className="score-accuracy">
          {unplayed ? "Not played" : `${chart.accuracy.toFixed(2)}%`}
        </p>
        {!unplayed && <Rank score={chart.score} fc={chart.fc} />}
      </div>

      <div className="simulator">
        <div className="simulator-head">
          <label htmlFor="project-accuracy" className="simulator-label">
            Target Accuracy
          </label>
          <span className="simulator-value">
            <input
              id="project-accuracy"
              aria-label="Projected chart accuracy"
              type="number"
              min="0"
              max="100"
              step="0.01"
              value={accuracy}
              onChange={(e) => onAccuracy(e.target.value)}
            />
            %
          </span>
        </div>
        <AccuracySlider value={Number(accuracy) || 0} onChange={onAccuracy} />
        <p className="footnote">*Drag to see how this chart would move your ranking score.</p>
        {!validAccuracy ? (
          <p className="meta">Enter an accuracy between 0 and 100%.</p>
        ) : (
          projected &&
          next && (
            <div className="stat-row projection-result">
              <div className="stat">
                <p className="stat-value">{projected.rks.toFixed(3)}</p>
                <span className="stat-label">Chart RKS</span>
              </div>
              <div className="stat">
                <p className="stat-value">{next.rankingScore.toFixed(3)}</p>
                <span className="stat-label">Projected RKS</span>
              </div>
              <div className="stat">
                <p
                  className={`stat-value delta${next.rankingScore < ranking.rankingScore ? " negative" : ""}`}
                >
                  {signed(next.rankingScore - ranking.rankingScore, 3)}
                </p>
                <span className="stat-label">Change</span>
              </div>
            </div>
          )
        )}
      </div>
    </section>
  );
}
