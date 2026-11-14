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
 * RKS over time as a glowing white line over a faint area, from first to last with the change between them. Hovering
 * reads a point's date, RKS and rank.
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
  const [hover, setHover] = useState<number>();
  const values = points.map((point) => point.rks);
  const min = Math.min(...values);
  const max = Math.max(...values);
  // a change of a few thousandths stays small: the line spans at least a tenth of RKS, centered
  const span = Math.max(max - min, MIN_SPAN);
  const middle = (min + max) / 2;
  // a single day is a flat line across the chart
  const drawn = points.length === 1 ? [points[0]!, points[0]!] : points;
  const coords = drawn.map(
    (point, index) =>
      [(index / (drawn.length - 1)) * 100, 50 - ((point.rks - middle) / span) * 84] as const,
  );
  const line = coords.map(([x, y]) => `${x},${y}`).join(" ");
  // as shown: two values that read the same make no change
  const shownRks = (rks: number) => Number(rks.toFixed(3));
  const delta = Number((shownRks(values.at(-1)!) - shownRks(values[0]!)).toFixed(3));
  const shown = hover === undefined ? undefined : points[hover];
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.round(((event.clientX - box.left) / box.width) * (points.length - 1));
    setHover(Math.max(0, Math.min(points.length - 1, at)));
  };
  return (
    <>
      <p className="progress-period">
        {format.date(points[0]!.at, dates)}
        {points.length > 1 && ` → ${format.date(points.at(-1)!.at, dates)}`}
      </p>
      <div className="rks-plot" onPointerMove={pick} onPointerLeave={() => setHover(undefined)}>
        <svg
          className="rks-chart"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
          role="img"
          aria-label={t.history.trend(
            points.length,
            values[0]!.toFixed(3),
            values.at(-1)!.toFixed(3),
          )}
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
        {shown && hover !== undefined && (
          <p
            className={`rks-tip${coords[hover]![0] > 70 ? " end" : ""}`}
            style={{ left: `${coords[hover]![0]}%` }}
          >
            <span className="meta">{format.date(shown.at, dates)}</span>
            <span>RKS {shown.rks.toFixed(3)}</span>
            {shown.rank !== undefined && <span>#{format.number(shown.rank)}</span>}
          </p>
        )}
      </div>
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
