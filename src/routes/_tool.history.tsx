import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Arrow } from "../components/arrow";
import { RksHistory, SnapshotProgress } from "../components/history-panels";
import { calculateRanking } from "../metrics";
import { message, useSave } from "../save-context";
import { compareDocuments } from "../snapshots";
import { clearSnapshots, deleteSnapshot } from "../store";

export const Route = createFileRoute("/_tool/history")({
  head: () => ({
    meta: [{ title: "History — Phigros Tools" }],
  }),
  component: HistoryRoute,
});

function HistoryRoute() {
  const {
    loaded,
    snapshots,
    credentials,
    selectedPlayer,
    setSelectedPlayer,
    storeSave,
    openSnapshot,
    refresh,
    say,
  } = useSave();
  const [compareId, setCompareId] = useState<string>();
  if (!loaded && snapshots.length === 0) return null; // _tool.tsx redirects to "/" in this case
  const compared = snapshots.find((snapshot) => snapshot.id === compareId);
  const changes =
    compared && loaded && compared.playerId === loaded.playerId
      ? compareDocuments(compared.document, loaded.document)
      : undefined;
  const playerHistory = snapshots.filter(
    (snapshot) => !!loaded?.playerId && snapshot.playerId === loaded.playerId,
  );
  const groups = [...new Set(snapshots.map((snapshot) => snapshot.playerId ?? ""))];
  const activeGroup =
    selectedPlayer && groups.includes(selectedPlayer) ? selectedPlayer : (groups[0] ?? "");
  const groupSnapshots = snapshots.filter((snapshot) => (snapshot.playerId ?? "") === activeGroup);
  return (
    <div id="panel-history" role="tabpanel" aria-labelledby="tab-history" className="tab-panel">
      {loaded && (
        <div className="history-grid">
          <RksHistory history={playerHistory} />
          <SnapshotProgress history={playerHistory} />
        </div>
      )}
      <section id="snapshots" className="panel snapshot-panel" aria-labelledby="snapshots-heading">
        <div className="panel-head">
          <h2 id="snapshots-heading" className="panel-title">
            Snapshots
          </h2>
          <div className="panel-actions">
            <button
              id="saveSnapshot"
              type="button"
              className="btn"
              disabled={!loaded?.playerId}
              onClick={() => loaded && void storeSave(loaded).catch((e) => say(`✗ ${message(e)}`))}
            >
              Save current <Arrow />
            </button>
            <button
              id="clearSnapshots"
              type="button"
              className="btn btn-ghost btn-danger"
              disabled={!snapshots.length}
              onClick={() => {
                if (confirm("Delete every local snapshot?"))
                  void clearSnapshots()
                    .then(refresh)
                    .catch((e) => say(`✗ ${message(e)}`));
              }}
            >
              Delete all
            </button>
          </div>
        </div>
        <div id="snapshotList">
          {snapshots.length ? (
            <>
              <label className="select player-select">
                <span className="select-label">Player history</span>
                <select
                  id="player-group"
                  className="select-field"
                  value={activeGroup}
                  onChange={(e) => {
                    setSelectedPlayer(e.target.value);
                    setCompareId(undefined);
                  }}
                >
                  <option value="" disabled={!groups.includes("")}>
                    Legacy / unknown player
                  </option>
                  {groups.filter(Boolean).map((id) => (
                    <option key={id} value={id}>
                      {credentials.find((c) => c.playerId === id)?.nickname ?? id} · {id}
                    </option>
                  ))}
                </select>
              </label>
              <ol className="snapshot-list">
                {groupSnapshots.map((snapshot) => (
                  <li className="snapshot" key={snapshot.id}>
                    <p>
                      <span className="snapshot-date">
                        {new Date(snapshot.capturedAt).toLocaleString()}
                      </span>
                      <span className="snapshot-name">
                        {snapshot.document.source.name ?? "save"}
                      </span>
                    </p>
                    <span className="snapshot-rks">
                      <span className="sr-only">RKS </span>
                      {calculateRanking(snapshot.document).rankingScore.toFixed(3)}
                    </span>
                    <div className="snapshot-actions">
                      <button
                        type="button"
                        className="btn"
                        onClick={() => void openSnapshot(snapshot)}
                      >
                        Open
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={!snapshot.playerId || snapshot.playerId !== loaded?.playerId}
                        onClick={() => setCompareId(snapshot.id)}
                      >
                        Compare current
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger"
                        onClick={() =>
                          void deleteSnapshot(snapshot.id)
                            .then(refresh)
                            .catch((e) => say(`✗ ${message(e)}`))
                        }
                      >
                        Delete
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="meta">No snapshots saved. Import a save to start your local history.</p>
          )}
        </div>
        <div id="comparison" aria-live="polite">
          {changes && (
            <>
              <p className="meta">{changes.length} changed/new chart records</p>
              {changes.slice(0, 100).map((change) => (
                <p key={change.key} className="meta">
                  {change.songId} {change.level}: {change.scoreDelta >= 0 ? "+" : ""}
                  {change.scoreDelta} score, {change.accuracyDelta >= 0 ? "+" : ""}
                  {change.accuracyDelta.toFixed(2)}%
                </p>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
