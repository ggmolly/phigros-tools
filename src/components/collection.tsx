import type { CSSProperties } from "react";
import { catalogChartTotals, missingCharts } from "../catalog";
import type { SaveDocumentV1 } from "../document";
import { useFormat, useT } from "../i18n";
import { countLevels, LEVELS } from "../modules";
import { Difficulty, LEVEL_NAMES, LevelStats } from "./primitives";

export function CollectionTracker({ document }: { document: SaveDocumentV1 }) {
  const t = useT();
  const format = useFormat();
  const counts = countLevels(document.songs);
  const missing = missingCharts(document.songs);
  const rows = LEVELS.map((level, index) => ({
    level,
    ...counts[index]!,
    total: catalogChartTotals[index]!,
    missing: missing[index]!,
  }));
  const played = rows.reduce((sum, row) => sum + row.cleared, 0);
  const total = rows.reduce((sum, row) => sum + row.total, 0);
  const completion = total ? (played / total) * 100 : 0;
  return (
    <section id="collection" className="panel collection" aria-labelledby="collection-heading">
      <div className="panel-head">
        <h2 id="collection-heading" className="panel-title">
          {t.tabs.collection}
        </h2>
        <span className="panel-count">
          {t.collection.chartsPlayed(format.number(played), format.number(total))}
        </span>
      </div>
      <div className="collection-total">
        <p className="collection-total-label">{t.collection.totalCompletion}</p>
        <p className="collection-total-value">
          {Math.floor(completion)}
          <small>%</small>
        </p>
        <div
          className="progress-track"
          role="img"
          aria-label={t.collection.completionLabel(format.number(Math.floor(completion)))}
        >
          <span style={{ "--p": completion / 100 } as CSSProperties} />
        </div>
      </div>
      <div className="collection-grid">
        {rows.map((row) => {
          const percent = (row.cleared / (row.total || 1)) * 100;
          return (
            <article
              className={`collection-row${row.cleared ? "" : " locked"}`}
              key={row.level}
              aria-label={`${LEVEL_NAMES[row.level]} (${row.level})`}
            >
              <div className="stat-bar">
                <span className="collection-level" title={LEVEL_NAMES[row.level]}>
                  {row.level}
                </span>
                <LevelStats count={row} total={row.total} />
              </div>
              <div className="collection-progress">
                <div
                  className="progress-track"
                  role="img"
                  aria-label={t.collection.levelPlayed(
                    row.level,
                    format.number(row.cleared),
                    format.number(row.total),
                  )}
                >
                  <span style={{ "--p": percent / 100 } as CSSProperties} />
                </div>
                <span className="collection-percent">{Math.floor(percent)}%</span>
              </div>
            </article>
          );
        })}
      </div>
      {played < total && (
        <details className="collection-missing">
          <summary>
            {(total - played === 1 ? t.collection.notPlayedOne : t.collection.notPlayedMany)(
              total - played,
            )}
          </summary>
          {rows
            .filter((row) => row.missing.length > 0)
            .map((row) => (
              <div key={row.level}>
                <h4>
                  <Difficulty level={row.level} /> {t.collection.missing(row.missing.length)}
                </h4>
                <ul>
                  {row.missing.map((song) => (
                    <li key={song.id}>{song.title}</li>
                  ))}
                </ul>
              </div>
            ))}
        </details>
      )}
    </section>
  );
}
