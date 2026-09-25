import { useState } from "react";
import { type RankingResult, targetSuggestions } from "../../metrics";
import { Arrow } from "../arrow";
import { Difficulty } from "../primitives";

/** One-chart ways to reach a target RKS; picking one loads it into the simulator at the needed accuracy. */
export function NextTarget({
  ranking,
  onPick,
}: {
  ranking: RankingResult;
  onPick: (key: string, accuracy: string) => void;
}) {
  const [target, setTarget] = useState(
    Math.min(20, Math.ceil((ranking.rankingScore + 0.01) * 100) / 100).toFixed(2),
  );
  const valid = target !== "" && Number(target) >= 0 && Number(target) <= 20;
  const candidates = valid ? targetSuggestions(ranking, Number(target)) : [];
  return (
    <section className="panel target" aria-labelledby="target-heading">
      <div className="panel-head">
        <h2 id="target-heading" className="panel-title">
          Next Target
        </h2>
        <label className="target-input" htmlFor="target-rks">
          <span>Target RKS</span>
          <input
            id="target-rks"
            className="field-white"
            aria-label="Target overall RKS"
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
        <p className="meta">Enter a target RKS between 0 and 20.</p>
      ) : candidates.length ? (
        <ul className="target-list">
          {candidates.map((candidate) => (
            <li key={candidate.key}>
              <button
                type="button"
                className="arrow-row target-item"
                title={
                  candidate.expectedAccuracy === undefined
                    ? undefined
                    : `You typically get about ${candidate.expectedAccuracy.toFixed(2)}% on charts of this level`
                }
                onClick={() => onPick(candidate.key, candidate.targetAccuracy.toFixed(2))}
              >
                <span className="target-song">{candidate.title}</span>
                {candidate.isNew && (
                  <span className="new-tag" title="Not played yet">
                    New
                  </span>
                )}
                {candidate.reach === "stretch" && (
                  <span
                    className="stretch-tag"
                    title="Needs a bit more than you usually get at this level"
                  >
                    Stretch
                  </span>
                )}
                <Difficulty level={candidate.level} />
                <span className="target-accuracy">
                  <span className="target-from">
                    {candidate.isNew ? "—" : `${candidate.accuracy.toFixed(2)}%`}
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
          {Number(target) <= ranking.rankingScore
            ? "You have already reached this target."
            : "No realistic one-chart improvement reaches that target yet. Try a smaller step."}
        </p>
      )}
    </section>
  );
}
