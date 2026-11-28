import { type CSSProperties, type ReactNode, useState } from "react";

/*
 * The plots only /admin draws, beside LinePlot (components/rks-history.tsx), whose box and tip they share. All are one
 * ink: what a mark is of is always written beside it.
 */

/**
 * Bars standing on a baseline, one per value, as high as their share of the largest. Hovering reads one through
 * `tip`, and `ends` names the first and the last under them.
 */
export function Bars({
  values,
  label,
  tip,
  ends,
}: {
  values: number[];
  label: string;
  tip: (index: number) => ReactNode;
  ends: [first: string, last: string];
}) {
  const [hover, setHover] = useState<number>();
  const high = Math.max(1, ...values);
  const pick = (event: React.PointerEvent<HTMLDivElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = Math.floor(((event.clientX - box.left) / box.width) * values.length);
    setHover(Math.max(0, Math.min(values.length - 1, at)));
  };
  // biome-ignore-start lint/suspicious/noArrayIndexKey: a bar is its place
  return (
    <div className="rks-plot" onPointerMove={pick} onPointerLeave={() => setHover(undefined)}>
      <svg
        className="rks-chart"
        viewBox={`0 0 ${values.length} 100`}
        preserveAspectRatio="none"
        role="img"
        aria-label={label}
      >
        {values.map((value, at) => {
          // the smallest count still shows
          const height = value && Math.max(1.5, (value / high) * 94);
          return (
            <rect
              key={at}
              className={at === hover ? "bar read" : "bar"}
              x={at + 0.12}
              width={0.76}
              y={100 - height}
              height={height}
            />
          );
        })}
      </svg>
      {hover !== undefined && (
        <p
          className={`rks-tip${hover / values.length > 0.7 ? " end" : ""}`}
          style={{ left: `${((hover + 0.5) / values.length) * 100}%` }}
        >
          {tip(hover)}
        </p>
      )}
      <p className="plot-ends">
        <span>{ends[0]}</span>
        <span>{ends[1]}</span>
      </p>
    </div>
  );
  // biome-ignore-end lint/suspicious/noArrayIndexKey: a bar is its place
}

const share = (value: number, high: number) => ({ "--share": value / high }) as CSSProperties;

/** A row per name: a bar as long as its share of the largest, then its number, or what `shown` says of it. */
export function Shares({ rows }: { rows: [name: ReactNode, value: number, shown?: ReactNode][] }) {
  const high = Math.max(1, ...rows.map(([, value]) => value));
  return (
    <ul className="shares">
      {rows.map(([name, value, shown], at) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: rows are replaced whole
        <li key={at}>
          <span>{name}</span>
          <i style={share(value, high)} />
          <b>{shown ?? value.toLocaleString("en")}</b>
        </li>
      ))}
    </ul>
  );
}

const WEEK = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const HOURS = Array.from({ length: 24 }, (_, hour) => hour);

/** The hours of a week, monday first, each cell the brighter the more `count` finds in it, read by hovering it. */
export function Heat({
  count,
  unit,
}: {
  count: (weekday: number, hour: number) => number;
  unit: string;
}) {
  const high = Math.max(1, ...WEEK.flatMap((_, day) => HOURS.map((hour) => count(day, hour))));
  return (
    <div className="heat">
      {WEEK.map((name, day) => (
        <div key={name}>
          <span>{name}</span>
          {HOURS.map((hour) => (
            <i
              key={hour}
              style={share(count(day, hour), high)}
              title={`${name} ${hour}:00, ${count(day, hour)} ${unit}`}
            />
          ))}
        </div>
      ))}
      <div aria-hidden="true">
        <span />
        {HOURS.map((hour) => (
          <small key={hour}>{hour % 3 ? "" : hour}</small>
        ))}
      </div>
    </div>
  );
}
