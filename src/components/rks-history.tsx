import { useState } from "react";
import { useFormat, useT } from "../i18n";
import type { PlayerProfile } from "../plays";
import { DATE_TIME, signed } from "./primitives";

const MIN_SPAN = 0.1;

/** A point of an RKS line: when, the RKS then, and the player's rank when the server kept it. */
export interface RksPoint {
  at: string | number;
  rks: number;
  rank?: number;
}

/**
 * A glowing white line over a faint area, drawn between `low` and `high`. Hovering reads a point through `tip`.
 */
export function LinePlot({
  values,
  low,
  high,
  label,
  tip,
}: {
  values: number[];
  low: number;
  high: number;
  label: string;
  tip: (index: number) => React.ReactNode;
}) {
  const [hover, setHover] = useState<number>();
  // a single point is a flat line across the chart
  const drawn = values.length === 1 ? [values[0]!, values[0]!] : values;
  const coords = drawn.map(
    (value, index) =>
      [(index / (drawn.length - 1)) * 100, 92 - ((value - low) / (high - low)) * 84] as const,
  );
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.round(((event.clientX - box.left) / box.width) * (values.length - 1));
    setHover(Math.max(0, Math.min(values.length - 1, at)));
  };
  return (
    <div className="rks-plot" onPointerMove={pick} onPointerLeave={() => setHover(undefined)}>
      <svg
        className="rks-chart"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        <polygon className="rks-area" points={`0,100 ${line} 100,100`} />
        {hover !== undefined && (
          <line
            className="rks-version"
            x1={coords[hover]![0]}
            x2={coords[hover]![0]}
            y1={0}
            y2={100}
            vectorEffect="non-scaling-stroke"
          />
        )}
        <polyline className="rks-line" points={line} vectorEffect="non-scaling-stroke" />
      </svg>
      {hover !== undefined && (
        <p
          className={`rks-tip${coords[hover]![0] > 70 ? " end" : ""}`}
          style={{ left: `${coords[hover]![0]}%` }}
        >
          {tip(hover)}
        </p>
      )}
    </div>
  );
}

/**
 * RKS over time, from first to last with the change between them. Hovering reads a point's date, RKS and rank.
 */
export function RksChart({
  points,
  dates = DATE_TIME,
}: {
  points: RksPoint[];
  dates?: Intl.DateTimeFormatOptions;
}) {
  const t = useT();
  const format = useFormat();
  const values = points.map((point) => point.rks);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // a change of a few thousandths stays small: the line spans at least a tenth of RKS, centered
  const span = Math.max(max - min, MIN_SPAN);
  const middle = (min + max) / 2;
  // as shown: two values that read the same make no change
  const shownRks = (rks: number) => Number(rks.toFixed(3));
  const delta = Number((shownRks(values.at(-1)!) - shownRks(values[0]!)).toFixed(3));
  return (
    <>
      <p className="progress-period">
        {format.date(points[0]!.at, dates)}
        {points.length > 1 && ` → ${format.date(points.at(-1)!.at, dates)}`}
      </p>
      <LinePlot
        values={values}
        low={middle - span / 2}
        high={middle + span / 2}
        label={t.history.trend(points.length, values[0]!.toFixed(3), values.at(-1)!.toFixed(3))}
        tip={(index) => (
          <>
            <span className="meta">{format.date(points[index]!.at, dates)}</span>
            <span>RKS {points[index]!.rks.toFixed(3)}</span>
            {points[index]!.rank !== undefined && (
              <span>#{format.number(points[index]!.rank)}</span>
            )}
          </>
        )}
      />
      <p className="rks-range">
        <span className="meta">{values[0]!.toFixed(3)}</span>
        <strong className={delta < 0 ? "negative" : ""}>{signed(delta, 3)}</strong>
        <span className="meta">{values.at(-1)!.toFixed(3)}</span>
      </p>
    </>
  );
}

/** A player's RKS once a day, as the server kept it with their rank. */
export function RksHistory({ history }: { history: PlayerProfile["history"] }) {
  const t = useT();
  if (!history.length) return null;
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.profile.rksHistory}</h2>
      </div>
      <RksChart
        points={history.map((day) => ({ at: day.day, rks: day.rks, rank: day.rank }))}
        dates={{ year: "numeric", month: "short", day: "numeric" }}
      />
    </section>
  );
}
