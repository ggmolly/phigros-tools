import { LEVELS, type LevelName } from "../modules";

export const LEVEL_NAMES: Record<LevelName, string> = {
  EZ: "Easy",
  HD: "Hard",
  IN: "Insane",
  AT: "Another",
};
const RANKS: [number, string][] = [
  [960_000, "V"],
  [920_000, "S"],
  [880_000, "A"],
  [820_000, "B"],
  [700_000, "C"],
];

/** Phigros shows scores as 7 zero-padded digits: 0997907. */
export function score7(score: number) {
  return String(Math.round(score)).padStart(7, "0");
}
export function signed(value: number, digits: number) {
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}`;
}

/** In-game grade: φ for an all-perfect, blue V for any full combo, otherwise by score. */
export function rankOf(score: number, fc: boolean) {
  if (score >= 1_000_000) return "φ";
  if (fc) return "V";
  return RANKS.find(([min]) => score >= min)?.[1] ?? "F";
}

export function Rank({ score, fc }: { score: number; fc: boolean }) {
  const rank = rankOf(score, fc);
  const kind = rank === "φ" ? "phi" : fc ? "fc" : "plain";
  const label = rank === "φ" ? "All Perfect" : fc ? "Full Combo" : `Rank ${rank}`;
  return (
    <span className={`rank rank-${kind}`} role="img" aria-label={label} title={label}>
      {rank}
    </span>
  );
}

export function Difficulty({ level }: { level: string }) {
  return <span className={`difficulty difficulty-${level.toLowerCase()}`}>{level}</span>;
}

/** "All / EZ / HD / IN / AT" segmented filter, shared by the Records table and the /charts list. */
export function DifficultyFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset's default browser styling (border/padding) would need a reset; role="group" is valid ARIA for a button group.
    <div className="seg" role="group" aria-label="Difficulty">
      {[["", "All"], ...LEVELS.map((level, index) => [String(index), level])].map(
        ([optionValue, label]) => (
          <button
            key={label}
            type="button"
            className={`seg-option seg-${label!.toLowerCase()}`}
            aria-pressed={value === optionValue}
            onClick={() => onChange(optionValue!)}
          >
            {label}
          </button>
        ),
      )}
    </div>
  );
}

export function Stat({ label, value, total }: { label: string; value: number; total?: number }) {
  return (
    <div className="stat">
      <p>
        <span className="stat-value">{value}</span>
        {total !== undefined && <span className="stat-total">/{total}</span>}
      </p>
      <span className="stat-label">{label}</span>
    </div>
  );
}

/** Cleared / Full Combo / Phi out of one difficulty's chart total. */
export function LevelStats({
  count,
  total,
}: {
  count: { cleared: number; fc: number; phi: number };
  total: number;
}) {
  return (
    <div className="stat-row">
      <Stat label="Cleared" value={count.cleared} total={total} />
      <Stat label="Full Combo" value={count.fc} total={total} />
      <Stat label="Phi" value={count.phi} total={total} />
    </div>
  );
}
