import { createFileRoute, Link } from "@tanstack/react-router";
import { useRef, useState } from "react";
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
          <ImportGuide />
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

type Platform = "android" | "ios";

/** iPadOS reports itself as a Mac, so a touch-capable "Macintosh" counts as iOS too. */
function guessPlatform(): Platform {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
    ? "ios"
    : "android";
}

/** Opt-in walkthrough of the import methods, per platform. Nothing forces it open: the site is browsable without a save. */
function ImportGuide() {
  const { dialog: tokenDialog, connectAndroid, busy } = useSave();
  const guide = useRef<HTMLDialogElement>(null);
  const [platform, setPlatform] = useState<Platform>("android");
  return (
    <>
      <button
        type="button"
        className="btn btn-ghost"
        onClick={() => {
          setPlatform(guessPlatform());
          guide.current?.showModal();
        }}
      >
        How to import <Arrow />
      </button>
      <dialog ref={guide} id="guideDialog" aria-labelledby="guide-heading">
        <form method="dialog" className="dialog-head">
          <h2 id="guide-heading">How to Import</h2>
          {/* biome-ignore lint/a11y/useButtonType: the default submit type closes the method="dialog" form. */}
          <button className="dialog-close" aria-label="Close import guide">
            ×
          </button>
        </form>
        <p className="meta">
          phigros.tools reads your <strong>TapTap cloud save</strong>, so sync it first: in Phigros,
          open <strong>Settings → Profile</strong>, log in with TapTap and tap{" "}
          <strong>Sync Now</strong>. Only the global version of the game is supported; the China
          version is untested.
        </p>
        {/* biome-ignore lint/a11y/useSemanticElements: same button group as DifficultyFilter. */}
        <div className="seg" role="group" aria-label="Platform">
          {(
            [
              ["android", "Android"],
              ["ios", "iOS"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="seg-option"
              aria-pressed={platform === value}
              onClick={() => setPlatform(value)}
            >
              {label}
            </button>
          ))}
        </div>
        {platform === "android" ? (
          <>
            <ol className="guide-steps">
              <li>
                On the phone, open <strong>Settings → About phone</strong> and tap{" "}
                <strong>Build number</strong> seven times to unlock Developer options.
              </li>
              <li>
                In <strong>Developer options</strong>, turn on <strong>USB debugging</strong>.
              </li>
              <li>
                Plug the phone into a computer and open this site in <strong>Chrome</strong> or{" "}
                <strong>Edge</strong> (Firefox and Safari can’t talk to USB devices).
              </li>
              <li>
                Choose <strong>Android (USB)</strong>, pick your phone, then tap{" "}
                <strong>Allow</strong> on the phone.
              </li>
            </ol>
            <p className="meta">
              Your session token is then remembered in this browser, so later syncs need no cable
              and you can turn USB debugging back off.
            </p>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  guide.current?.close();
                  void connectAndroid();
                }}
              >
                Connect Android <Arrow />
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="guide-note">
              iOS doesn’t let a computer read Phigros’ login, so there’s no one-tap import yet.
            </p>
            <ul className="guide-steps">
              <li>
                If you already have your <strong>session token</strong> (some Phigros tools and bots
                show it), paste it under <strong>Session token</strong>.
              </li>
              <li>
                Otherwise, log in to Phigros on an Android phone or emulator with the same TapTap
                account, sync, and follow the Android steps once. The token is remembered
                afterwards.
              </li>
            </ul>
            <div className="dialog-actions">
              <button
                type="button"
                className="btn"
                onClick={() => {
                  guide.current?.close();
                  tokenDialog.current?.showModal();
                }}
              >
                Enter session token <Arrow />
              </button>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
