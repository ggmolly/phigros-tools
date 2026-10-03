import { useState } from "react";
import type { RankingResult } from "../../metrics";
import { PhiSlot, Rank } from "../primitives";

/** The Phi slots then the Best charts, song-select style; picking one selects it in the detail panel. */
export function BestList({
  ranking,
  selectedKey,
  onPick,
}: {
  ranking: RankingResult;
  selectedKey: string;
  onPick: (key: string) => void;
}) {
  const entries: { record: (typeof ranking.best)[number]; slot: string; phi?: number }[] = [
    ...ranking.phi.map((record, index) => ({ record, slot: `φ${index + 1}`, phi: index })),
    ...ranking.best.map((record, index) => ({ record, slot: String(index + 1).padStart(2, "0") })),
  ];
  // A φ chart is usually in the Best list too: highlight only the row that was clicked (else its first row),
  // since white means "the one selected thing".
  const [pickedSlot, setPickedSlot] = useState<string>();
  const selectedSlot = (
    entries.find(({ record, slot }) => slot === pickedSlot && record.key === selectedKey) ??
    entries.find(({ record }) => record.key === selectedKey)
  )?.slot;
  return (
    <section className="best-list" aria-labelledby="best-heading">
      <div className="list-head">
        <h2 id="best-heading" className="panel-title">
          Best {ranking.best.length}
        </h2>
        <span className="panel-count">
          + {ranking.phi.length} Phi slot{ranking.phi.length === 1 ? "" : "s"}
        </span>
      </div>
      <ol className="song-list">
        {entries.map(({ record, slot, phi }) => {
          const selected = slot === selectedSlot;
          return (
            <li key={`${slot}:${record.key}`}>
              <button
                type="button"
                className={`song-row${selected ? " selected" : ""}`}
                aria-pressed={selected}
                onClick={() => {
                  setPickedSlot(slot);
                  onPick(record.key);
                }}
              >
                {phi === undefined ? (
                  <span className="song-slot">{slot}</span>
                ) : (
                  <span className="song-slot phi">
                    φ<PhiSlot index={phi} />
                  </span>
                )}
                <span className="song-name">
                  <span className="song-title">{record.title}</span>
                  <span className="song-artist">{record.artist}</span>
                </span>
                <Rank score={record.score} fc={record.fc} />
                <span className="song-level">
                  <span className="song-level-number">{record.rks.toFixed(2)}</span>
                  <span className="song-level-name">
                    {record.level}
                    {selected && ` ${record.constant.toFixed(1)}`}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
