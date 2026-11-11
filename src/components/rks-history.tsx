import { useState } from "react";
import { useFormat, useT } from "../i18n";
import type { PlayerProfile } from "../plays";

const W = 800;
const H = 200;
const PAD = { top: 16, right: 16, bottom: 28, left: 72 };

/** A player's RKS once a day, one line with a crosshair and a tooltip giving the day's RKS and rank. */
export function RksHistory({ history }: { history: PlayerProfile["history"] }) {
  const t = useT();
  const format = useFormat();
  const [hover, setHover] = useState<number>();
  if (!history.length) return null;
  const values = history.map((day) => day.rks);
  // a little room around the line, and a range even for a flat one
  const low = Math.max(0, Math.min(...values) - 0.05);
  const high = Math.max(...values) + 0.05;
  const x = (i: number) =>
    PAD.left +
    (history.length === 1
      ? (W - PAD.left - PAD.right) / 2
      : (i / (history.length - 1)) * (W - PAD.left - PAD.right));
  const y = (rks: number) =>
    PAD.top + (1 - (rks - low) / (high - low)) * (H - PAD.top - PAD.bottom);
  const ticks = [low, (low + high) / 2, high];
  const shown = hover === undefined ? undefined : history[hover];
  const pick = (event: React.PointerEvent<SVGSVGElement>) => {
    const box = event.currentTarget.getBoundingClientRect();
    const at = ((event.clientX - box.left) / box.width) * W;
    const i = Math.round(((at - PAD.left) / (W - PAD.left - PAD.right)) * (history.length - 1));
    setHover(Math.max(0, Math.min(history.length - 1, i)));
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2 className="panel-title">{t.profile.rksHistory}</h2>
      </div>
      <div className="rks-history">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          role="img"
          aria-label={t.profile.rksHistory}
          onPointerMove={pick}
          onPointerLeave={() => setHover(undefined)}
        >
          {ticks.map((tick) => (
            <g key={tick}>
              <line
                className="rks-history-grid"
                x1={PAD.left}
                x2={W - PAD.right}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text
                className="rks-history-label"
                x={PAD.left - 8}
                y={y(tick)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {tick.toFixed(2)}
              </text>
            </g>
          ))}
          <text className="rks-history-label" x={x(0)} y={H - 6} textAnchor="start">
            {format.date(history[0]!.day)}
          </text>
          {history.length > 1 && (
            <text
              className="rks-history-label"
              x={x(history.length - 1)}
              y={H - 6}
              textAnchor="end"
            >
              {format.date(history.at(-1)!.day)}
            </text>
          )}
          <polyline
            className="rks-history-line"
            points={history.map((day, i) => `${x(i)},${y(day.rks)}`).join(" ")}
          />
          {shown && hover !== undefined && (
            <>
              <line
                className="rks-history-cross"
                x1={x(hover)}
                x2={x(hover)}
                y1={PAD.top}
                y2={H - PAD.bottom}
              />
              <circle className="rks-history-dot" cx={x(hover)} cy={y(shown.rks)} r={5} />
            </>
          )}
          {history.length === 1 && (
            <circle className="rks-history-dot" cx={x(0)} cy={y(values[0]!)} r={5} />
          )}
        </svg>
        {shown && hover !== undefined && (
          <p className="rks-history-tip" style={{ left: `${(x(hover) / W) * 100}%` }}>
            <span className="meta">{format.date(shown.day)}</span>
            <span>RKS {shown.rks.toFixed(3)}</span>
            <span>#{format.number(shown.rank)}</span>
          </p>
        )}
      </div>
    </section>
  );
}
