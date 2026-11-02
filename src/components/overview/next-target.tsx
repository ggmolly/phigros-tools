import { useState } from "react";
import { useChartSimilarity } from "../../chartSimilarity";
import { useT } from "../../i18n";
import type { Messages } from "../../i18n/messages";
import { type RankingResult, type TargetSuggestion, targetSuggestions } from "../../metrics";
import { Arrow } from "../arrow";
import { Difficulty } from "../primitives";

/** Within reach, and built like a chart they've already played: the suggestions worth trying first. */
const recommended = (suggestion: TargetSuggestion) =>
  suggestion.reach === "likely" && suggestion.similarTo !== undefined;

/** Why a suggestion's expected accuracy is what it is, for its tooltip. */
function expectation(t: Messages, suggestion: TargetSuggestion) {
  const { expectedAccuracy, similarTo, reach } = suggestion;
  if (expectedAccuracy === undefined) return undefined;
  return [
    recommended(suggestion) && t.overview.recommended,
    suggestion.isNew && t.common.notPlayedYet,
    t.overview.typically(expectedAccuracy.toFixed(2)),
    similarTo &&
      t.overview.playsLike(similarTo.title, similarTo.level, similarTo.accuracy.toFixed(2)),
    reach === "stretch" && t.overview.stretch,
  ]
    .filter(Boolean)
    .join(" ");
}

/** One-chart ways to reach a target RKS; picking one loads it into the simulator at the needed accuracy. */
export function NextTarget({
  ranking,
  onPick,
}: {
  ranking: RankingResult;
  onPick: (key: string, accuracy: string) => void;
}) {
  const t = useT();
  const [target, setTarget] = useState(
    Math.min(20, Math.ceil((ranking.rankingScore + 0.01) * 100) / 100).toFixed(2),
  );
  const valid = target !== "" && Number(target) >= 0 && Number(target) <= 20;
  const similarity = useChartSimilarity();
  const candidates = valid ? targetSuggestions(ranking, Number(target), { similarity }) : [];
  return (
    <section className="panel target" aria-labelledby="target-heading">
      <div className="panel-head">
        <h2 id="target-heading" className="panel-title">
          {t.overview.nextTarget}
        </h2>
        <label className="target-input" htmlFor="target-rks">
          <span>{t.overview.targetRks}</span>
          <input
            id="target-rks"
            className="field-white"
            aria-label={t.overview.targetRksLabel}
            type="number"
            min="0"
            max="20"
            step="0.01"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
          />
        </label>
      </div>
      {!valid ? (
        <p className="meta">{t.overview.targetRange}</p>
      ) : candidates.length ? (
        <ul className="target-list">
          {candidates.map((candidate) => (
            <li key={candidate.key}>
              <button
                type="button"
                className="arrow-row target-item"
                title={expectation(t, candidate)}
                onClick={() => onPick(candidate.key, candidate.targetAccuracy.toFixed(2))}
              >
                <span
                  className={recommended(candidate) ? "target-song recommended" : "target-song"}
                >
                  {candidate.title}
                </span>
                <Difficulty level={candidate.level} />
                <span className="target-accuracy">
                  <span className="target-from">
                    {candidate.isNew ? t.overview.new : `${candidate.accuracy.toFixed(2)}%`}
                  </span>{" "}
                  → {candidate.targetAccuracy.toFixed(2)}%
                </span>
                <span className="arrow-chip">
                  <Arrow />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="meta">
          {Number(target) <= ranking.rankingScore ? t.overview.reached : t.overview.noImprovement}
        </p>
      )}
    </section>
  );
}
