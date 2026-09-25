import { createFileRoute, Link } from "@tanstack/react-router";
import { Arrow, SyncIcon } from "../components/arrow";
import { Overview } from "../components/overview";
import { useSave } from "../save-context";
import { jsonLd, SITE, SITE_DESCRIPTION, SITE_NAME } from "../seo";

export const Route = createFileRoute("/_tool/")({
  head: () => ({
    scripts: [
      jsonLd({
        "@type": "WebSite",
        name: SITE_NAME,
        alternateName: "phigros.tools",
        url: `${SITE}/`,
        description: SITE_DESCRIPTION,
      }),
    ],
  }),
  component: OverviewRoute,
});

function OverviewRoute() {
  const { loaded, credentials, snapshots, sync, busy, fileInput, syncPlayer, syncLabel } =
    useSave();
  const loadedCredential = loaded && credentials.find((c) => c.playerId === loaded.playerId);
  return (
    <div id="panel-overview" role="tabpanel" aria-labelledby="tab-overview" className="tab-panel">
      {loaded ? (
        <Overview
          key={loaded.document.source.importedAt}
          document={loaded.document}
          playerName={loadedCredential?.nickname}
        />
      ) : (
        <section className="welcome" aria-labelledby="empty-heading">
          <p className="welcome-logo" aria-hidden="true">
            phigros<span>.</span>tools
          </p>
          <h1 id="empty-heading" className="welcome-title">
            Open a save to get started
          </h1>
          <p className="welcome-text">
            See your ranking, chart records, and progress in one place. Use one of the import
            methods above.
          </p>
          <button
            id="openLocalSave"
            type="button"
            className="btn"
            onClick={() => fileInput.current?.click()}
          >
            Choose local file <Arrow />
          </button>
          <Link to="/charts" className="btn btn-ghost">
            Browse the chart list <Arrow />
          </Link>
          {credentials.length > 0 && (
            <section className="welcome-back" aria-labelledby="welcome-back-heading">
              <h2 id="welcome-back-heading" className="welcome-back-title">
                Welcome back
              </h2>
              {credentials.map((credential) => {
                const latest = snapshots.find(
                  (snapshot) => snapshot.playerId === credential.playerId,
                );
                return (
                  <button
                    key={credential.playerId}
                    type="button"
                    className={`arrow-row welcome-player${sync?.playerId === credential.playerId ? ` sync-${sync.state}` : ""}`}
                    disabled={busy}
                    onClick={() => void syncPlayer(credential)}
                  >
                    <span>
                      <strong>{credential.nickname ?? credential.playerId}</strong>
                      <span className="import-description">
                        {syncLabel(
                          credential.playerId,
                          latest
                            ? `Last snapshot ${new Date(latest.capturedAt).toLocaleString()} · Sync Now`
                            : "Sync Now",
                        )}
                      </span>
                    </span>
                    <span className="arrow-chip">
                      <SyncIcon
                        spinning={
                          sync?.playerId === credential.playerId && sync.state === "syncing"
                        }
                      />
                    </span>
                  </button>
                );
              })}
            </section>
          )}
        </section>
      )}
    </div>
  );
}
