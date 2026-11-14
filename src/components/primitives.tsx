import type { CSSProperties, ReactNode, Ref } from "react";
import avatars from "../avatars.json";
import { useFormat, useT } from "../i18n";
import { LEVELS } from "../modules";

// toLocaleDateString rejects timeStyle, so the time is asked for field by field.
export const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
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
  const t = useT();
  const kind = rank === "φ" ? "phi" : fc ? "fc" : "plain";
  const label = rank === "φ" ? "All Perfect" : fc ? t.menu.fullCombo : t.common.rank(rank);
  return (
    <span className={`rank rank-${kind}`} role="img" aria-label={label} title={label}>
      {rank}
    </span>
  );
}

/** Which Phi slot a chart fills, as a raised digit after its φ (φ¹ φ² φ³). A styled <sup> rather than ¹²³:
 * the subset Saira has no superscript glyphs. */
export function PhiSlot({ index }: { index: number }) {
  const label = useT().common.phiSlot(index + 1);
  return (
    <sup className="phi-slot" title={label}>
      <span className="sr-only">{label}</span>
      <span aria-hidden="true">{index + 1}</span>
    </sup>
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
  const t = useT();
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset's default browser styling (border/padding) would need a reset; role="group" is valid ARIA for a button group.
    <div className="seg" role="group" aria-label={t.common.difficulty}>
      {[
        ["", "all", t.common.all],
        ...LEVELS.map((level, index) => [String(index), level, level]),
      ].map(([optionValue, kind, label]) => (
        <button
          key={kind}
          type="button"
          className={`seg-option seg-${kind!.toLowerCase()}`}
          aria-pressed={value === optionValue}
          onClick={() => onChange(optionValue!)}
        >
          {label}
        </button>
      ))}
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
  const format = useFormat();
  const shown = (part: React.ReactNode) => (typeof part === "number" ? format.number(part) : part);
  return (
    <div className={className ? `stat ${className}` : "stat"}>
      <p>
        <span className="stat-value">{shown(value)}</span>
        {total !== undefined && (
          <span className="stat-total">
            {typeof total === "number" ? `/${shown(total)}` : total}
          </span>
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
  const t = useT();
  return (
    <div className="stat-row">
      <Stat label={t.common.cleared} value={count.cleared} total={total} />
      <Stat label={t.menu.fullCombo} value={count.fc} total={total} />
      <Stat label="Phi" value={count.phi} total={total} />
    </div>
  );
}

const CHALLENGE_COLOURS = ["White", "Green", "Blue", "Red", "Gold", "Rainbow"] as const;

/** Challenge Mode rank as stored in saves: hundreds = colour, rest = level (548 → Rainbow 48). Undefined if never played. */
export function challengeRank(value: number) {
  const colour = CHALLENGE_COLOURS[Math.floor(value / 100)];
  const level = value % 100;
  return colour && level > 0 ? { colour, level } : undefined;
}

const DATA_UNITS = ["KB", "MB", "GB", "TB", "PB"];

/** The in-game "Data" currency: `money` is [KB, MB, GB, TB, PB], each unit 1024 of the one below. Shown in its
 * largest unit with one decimal (rounded down, so 1023 KB never reads as a full unit): 56 MB 342 KB → 56.3 MB. */
export function dataAmount(money: readonly number[]) {
  const top = Math.max(
    0,
    money.findLastIndex((amount) => amount > 0),
  );
  const amount = (money[top] ?? 0) + (top > 0 ? (money[top - 1] ?? 0) / 1024 : 0);
  return {
    value: top > 0 ? (Math.floor(amount * 10) / 10).toFixed(1) : String(amount),
    unit: ` ${DATA_UNITS[top]}`,
  };
}

/** URL of an in-game avatar by the name saves store (see scripts/build-avatars.ts); "" is the game's default. */
export function avatarUrl(name: string) {
  const file = (avatars as Record<string, string>)[name || "Introduction"] ?? name;
  return `/avatars/${encodeURIComponent(file)}.avif`;
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

export function Slider({
  value,
  min,
  max,
  step,
  label,
  onChange,
  className = "",
  boxRef,
  inputRef,
  children,
}: {
  value?: number;
  min: number;
  max: number;
  step: number | "any";
  label: string;
  onChange: (value: number) => void;
  className?: string;
  boxRef?: Ref<HTMLDivElement>;
  inputRef?: Ref<HTMLInputElement>;
  /** drawn on the track, under the thumb */
  children?: ReactNode;
}) {
  const style =
    value === undefined ? undefined : ({ "--p": (value - min) / (max - min) } as CSSProperties);
  return (
    <div ref={boxRef} className={`slider ${className}`} style={style}>
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        defaultValue={value === undefined ? min : undefined}
        aria-label={label}
        onChange={(event) => onChange(Number(event.currentTarget.value))}
      />
      <span className="slider-fill" aria-hidden="true" />
      {children}
      <span className="slider-thumb" aria-hidden="true" />
    </div>
  );
}

export function Switch({
  checked,
  label,
  onChange,
}: {
  checked: boolean;
  label: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className="switch"
      onClick={() => onChange(!checked)}
    >
      <svg className="switch-check" viewBox="0 0 40 27" aria-hidden="true">
        <path d="M2 11.5 15.5 25 38 2" />
      </svg>
      <span className="switch-thumb" aria-hidden="true" />
    </button>
  );
}
