import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Arrow } from "../components/arrow";
import { DATE_TIME, SnapshotHistory, SnapshotProgress } from "../components/history-panels";
import { useSendToPhigrospp } from "../components/phigrospp";
import { useFormat, useT } from "../i18n";
import { calculateRanking } from "../metrics";
import { message, useSave } from "../save-context";
import { headT, pageMeta } from "../seo";
import { compareDocuments } from "../snapshots";
import { clearSnapshots, deleteSnapshot } from "../store";

export const Route = createFileRoute("/_tool/history")({
  // Empty without a save, so kept out of search results; "/" is the page to index.
  head: ({ match }) => {
    const { locale, t } = headT(match);
    return {
      meta: [
        ...pageMeta({
          title: t.seo.historyTitle,
          description: t.seo.historyDescription,
          path: "/history",
          locale,
        }),
        { name: "robots", content: "noindex" },
      ],
    };
  },
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
  const t = useT();
  const format = useFormat();
  const send = useSendToPhigrospp();
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
          <SnapshotHistory history={playerHistory} />
          <SnapshotProgress history={playerHistory} />
        </div>
      )}
      <section id="snapshots" className="panel snapshot-panel" aria-labelledby="snapshots-heading">
        <div className="panel-head">
          <h2 id="snapshots-heading" className="panel-title">
            {t.history.snapshots}
          </h2>
          <div className="panel-actions">
            <button
              id="saveSnapshot"
              type="button"
              className="btn"
              disabled={!loaded?.playerId}
              onClick={() => loaded && void storeSave(loaded).catch((e) => say(`✗ ${message(e)}`))}
            >
              {t.history.saveCurrent} <Arrow />
            </button>
            <button
              id="clearSnapshots"
              type="button"
              className="btn btn-ghost btn-danger"
              disabled={!snapshots.length}
              onClick={() => {
                if (confirm(t.history.clearConfirm))
                  void clearSnapshots()
                    .then(refresh)
                    .catch((e) => say(`✗ ${message(e)}`));
              }}
            >
              {t.history.deleteAll}
            </button>
          </div>
        </div>
        <div id="snapshotList">
          {snapshots.length ? (
            <>
              <label className="select player-select">
                <span className="select-label">{t.history.playerHistory}</span>
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
                    {t.history.legacy}
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
                        {format.date(snapshot.capturedAt, DATE_TIME)}
                      </span>
                      <span className="snapshot-name">
                        {snapshot.document.source.name ?? t.history.saveFallback}
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
                        {t.history.open}
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost"
                        disabled={!snapshot.playerId || snapshot.playerId !== loaded?.playerId}
                        onClick={() => setCompareId(snapshot.id)}
                      >
                        {t.history.compare}
                      </button>
                      {send &&
                        snapshot.rawZip &&
                        !credentials.some((c) => c.signer && c.playerId === snapshot.playerId) && (
                          <button
                            type="button"
                            className="btn btn-ghost"
                            onClick={() => send(snapshot.rawZip!)}
                          >
                            {t.ppp.send}
                          </button>
                        )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-danger"
                        onClick={() =>
                          void deleteSnapshot(snapshot.id)
                            .then(refresh)
                            .catch((e) => say(`✗ ${message(e)}`))
                        }
                      >
                        {t.history.delete}
                      </button>
                    </div>
                  </li>
                ))}
              </ol>
            </>
          ) : (
            <p className="meta">{t.history.empty}</p>
          )}
        </div>
        <div id="comparison" aria-live="polite">
          {changes && (
            <>
              <p className="meta">{t.history.changed(changes.length)}</p>
              {changes.slice(0, 100).map((change) => (
                <p key={change.key} className="meta">
                  {t.history.change(
                    change.songId,
                    change.level,
                    `${change.scoreDelta >= 0 ? "+" : ""}${format.number(change.scoreDelta)}`,
                    `${change.accuracyDelta >= 0 ? "+" : ""}${format.number(change.accuracyDelta, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`,
                  )}
                </p>
              ))}
            </>
          )}
        </div>
      </section>
    </div>
  );
}
