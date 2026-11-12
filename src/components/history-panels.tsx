import { catalogSong } from "../catalog";
import { useFormat, useT } from "../i18n";
import { rksSeries, snapshotProgress } from "../snapshots";
import type { SnapshotV1 } from "../store";
import { Arrow } from "./arrow";
import { Difficulty, signed } from "./primitives";
import { RksChart } from "./rks-history";

// toLocaleDateString rejects timeStyle, so the time is asked for field by field.
export const DATE_TIME: Intl.DateTimeFormatOptions = {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
};

export function SnapshotProgress({ history }: { history: SnapshotV1[] }) {
  const t = useT();
  const format = useFormat();
  const [latest, previous] = history;
  const progress = latest && previous ? snapshotProgress(previous, latest) : undefined;
  return (
    <section className="panel progress-panel" aria-labelledby="progress-heading">
      <div className="panel-head">
        <h2 id="progress-heading" className="panel-title">
          {t.history.sinceLast}
        </h2>
      </div>
      {progress ? (
        <>
          <p className="progress-period">
            {format.date(previous.capturedAt, DATE_TIME)} →{" "}
            {format.date(latest.capturedAt, DATE_TIME)}
          </p>
          <div className="stat-row progress-stats">
            {(
              [
                ["RKS", progress.rks, 3],
                ["Full Combo", progress.fc, 0],
                ["Phi", progress.ap, 0],
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
            <p className="progress-period">{t.history.rksIncomparable}</p>
          )}
          <p className="progress-subhead">{t.history.improved(progress.improvements.length)}</p>
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
            <span>{t.history.savesToCompare}</span>
          </div>
          <p>{history.length ? t.history.importAnother : t.history.importTwo}</p>
          <button
            type="button"
            className="arrow-row"
            onClick={() => document.querySelector<HTMLDialogElement>("#importDialog")?.showModal()}
          >
            {t.menu.importSave}
            <span className="arrow-chip">
              <Arrow />
            </span>
          </button>
        </div>
      )}
    </section>
  );
}

export function RksHistory({ history }: { history: SnapshotV1[] }) {
  const t = useT();
  const series = rksSeries(history);
  return (
    <section className="panel" aria-labelledby="rks-history-heading">
      <div className="panel-head">
        <h2 id="rks-history-heading" className="panel-title">
          {t.history.rksHistory}
        </h2>
      </div>
      {series.length < 3 ? (
        <p className="meta rks-hint">{t.history.thirdTime}</p>
      ) : (
        <RksChart
          points={series.map((point) => ({ at: point.capturedAt, rks: point.rks }))}
          marks={series.flatMap((point, index) =>
            point.versionChange
              ? [
                  {
                    index,
                    label:
                      point.versionChange === "catalog"
                        ? t.history.catalogUpdate
                        : point.versionChange,
                  },
                ]
              : [],
          )}
        />
      )}
    </section>
  );
}
