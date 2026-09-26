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

export function Stat({
  label,
  value,
  total,
  className,
}: {
  label: string;
  value: React.ReactNode;
  total?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className ? `stat ${className}` : "stat"}>
      <p>
        <span className="stat-value">{value}</span>
        {total !== undefined && (
          <span className="stat-total">{typeof total === "number" ? `/${total}` : total}</span>
        )}
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

const CHALLENGE_COLOURS = ["White", "Green", "Blue", "Red", "Gold", "Rainbow"];

/** Challenge Mode rank as stored in saves: hundreds = colour, rest = level (548 → Rainbow 48). Undefined if never played. */
export function challengeRank(value: number) {
  const colour = CHALLENGE_COLOURS[Math.floor(value / 100)];
  const level = value % 100;
  return colour && level > 0 ? { colour, level } : undefined;
}

const DATA_UNITS = ["KB", "MB", "GB", "TB", "PB"];

/** The in-game "Data" currency: `money` is [KB, MB, GB, TB, PB]; show the two largest units, like the game. */
export function dataAmount(money: readonly number[]) {
  const top = money.findLastIndex((amount) => amount > 0);
  if (top < 0) return { value: "0 KB" };
  return {
    value: `${money[top]} ${DATA_UNITS[top]}`,
    rest: top > 0 && money[top - 1] ? ` ${money[top - 1]} ${DATA_UNITS[top - 1]}` : undefined,
  };
}

/** URL of an in-game avatar (see scripts/build-avatars.ts); an empty name is the game's default. */
export function avatarUrl(name: string) {
  return `/avatars/${encodeURIComponent(name || "Introduction")}.avif`;
}

/** The player's in-game avatar. */
export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <img
      className={className}
      src={avatarUrl(name)}
      alt=""
      width={128}
      height={128}
      onError={(event) => {
        event.currentTarget.hidden = true;
      }}
    />
  );
}
