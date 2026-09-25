import { catalogRevision, catalogSong } from "../catalog";
import { rksSeries, snapshotProgress } from "../snapshots";
import type { SnapshotV1 } from "../store";
import { Arrow } from "./arrow";
import { Difficulty, signed } from "./primitives";

export function SnapshotProgress({ history }: { history: SnapshotV1[] }) {
  const [latest, previous] = history;
  const progress = latest && previous ? snapshotProgress(previous, latest) : undefined;
  return (
    <section className="panel progress-panel" aria-labelledby="progress-heading">
      <div className="panel-head">
        <h2 id="progress-heading" className="panel-title">
          Since Last Snapshot
        </h2>
      </div>
      {progress ? (
        <>
          <p className="progress-period">
            {new Date(previous.capturedAt).toLocaleString()} →{" "}
            {new Date(latest.capturedAt).toLocaleString()}
          </p>
          <div className="stat-row progress-stats">
            {(
              [
                ["RKS", progress.rks, 3],
                ["Full Combo", progress.fc, 0],
                ["All Perfect", progress.ap, 0],
              ] as const
            ).map(([label, value, digits]) => (
              <div className="stat" key={label}>
                <strong
                  className={`stat-value${value !== undefined && value < 0 ? " negative" : ""}`}
                >
                  {value === undefined ? "—" : signed(value, digits)}
                </strong>
                <span className="stat-label">{label}</span>
              </div>
            ))}
          </div>
          {progress.rks === undefined && (
            <p className="progress-period">
              RKS can’t be compared across catalog revisions or ranking rules.
            </p>
          )}
          <p className="progress-subhead">{progress.improvements.length} new or improved records</p>
          {progress.improvements.length > 0 && (
            <ol className="progress-records">
              {progress.improvements.slice(0, 5).map((change) => {
                const title = catalogSong(change.songId)?.title ?? change.songId;
                return (
                  <li key={change.key}>
                    <span title={title}>{title}</span>
                    <Difficulty level={change.level} />
                  </li>
                );
              })}
            </ol>
          )}
        </>
      ) : (
        <div className="progress-empty">
          <div className="progress-status">
            <strong>{history.length} / 2</strong>
            <span>Saves to compare</span>
          </div>
          <p>
            {history.length
              ? "Import another save from this player to compare RKS, FC and AP."
              : "Import two saves from the same player to compare RKS, FC and AP."}
          </p>
          <a className="arrow-row" href="#import">
            Import save
            <span className="arrow-chip">
              <Arrow />
            </span>
          </a>
        </div>
      )}
    </section>
  );
}

export function RksHistory({ history }: { history: SnapshotV1[] }) {
  const series = rksSeries(history, catalogRevision);
  const values = series.map((point) => point.rks);
  const delta = values.length > 1 ? values.at(-1)! - values[0]! : 0;
  const range = (
    <p className="rks-range">
      <span className="meta">{values[0]?.toFixed(3)}</span>
      <strong className={delta < 0 ? "negative" : ""}>{signed(delta, 3)}</strong>
      <span className="meta">{values.at(-1)?.toFixed(3)}</span>
    </p>
  );
  return (
    <section className="panel" aria-labelledby="rks-history-heading">
      <div className="panel-head">
        <h2 id="rks-history-heading" className="panel-title">
          RKS History
        </h2>
      </div>
      {series.length < 3 ? (
        <>
          <p className="meta rks-hint">
            {history.length < 3
              ? "Save a third time to unlock the trend line."
              : "RKS can’t be charted across catalog revisions or ranking rules."}
          </p>
          {series.length === 2 && range}
        </>
      ) : (
        (() => {
          const min = Math.min(...values);
          const max = Math.max(...values);
          const span = max - min || 1;
          const coords = series.map(
            (point, index) =>
              [(index / (series.length - 1)) * 100, 92 - ((point.rks - min) / span) * 84] as const,
          );
          const points = coords.map(([x, y]) => `${x},${y}`).join(" ");
          return (
            <>
              <p className="progress-period">
                {new Date(series[0]!.capturedAt).toLocaleString()} →{" "}
                {new Date(series.at(-1)!.capturedAt).toLocaleString()}
              </p>
              <svg
                className="rks-chart"
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                role="img"
                aria-label={`RKS trend across ${series.length} snapshots: from ${values[0]!.toFixed(3)} to ${values.at(-1)!.toFixed(3)}`}
              >
                <polygon className="rks-area" points={`0,100 ${points} 100,100`} />
                <polyline className="rks-line" points={points} vectorEffect="non-scaling-stroke" />
              </svg>
              {range}
            </>
          );
        })()
      )}
    </section>
  );
}
