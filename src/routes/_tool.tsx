import { createFileRoute, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect } from "react";
import { Arrow, SyncIcon } from "../components/arrow";
import { SiteHeader, TAB_LABEL, type TabId, toolTabs } from "../components/chrome";
import { Avatar } from "../components/primitives";
import { calculateRanking } from "../metrics";
import { message, useSave } from "../save-context";
import { SITE } from "../seo";
import { deleteCredential } from "../store";

export const Route = createFileRoute("/_tool")({
  head: () => ({ links: [{ rel: "canonical", href: `${SITE}/` }] }),
  component: ToolLayout,
});

function download(name: string, value: string | Uint8Array, type = "application/octet-stream") {
  const url = URL.createObjectURL(
    new Blob([typeof value === "string" ? value : new Uint8Array(value)], { type }),
  );
  Object.assign(document.createElement("a"), { href: url, download: name }).click();
  setTimeout(() => URL.revokeObjectURL(url));
}

/** The four tabs share one layout (topbar, import band, dialogs); each tab's own content is a real child
 * route (see _tool.*.tsx). The loaded save lives in <SaveProvider> at the root, so it survives visiting /charts. */
function ToolLayout() {
  const {
    loaded,
    snapshots,
    credentials,
    sync,
    busy,
    log,
    token,
    setToken,
    usbPhase,
    usbEvents,
    unsupportedZip,
    storageReady,
    dialog,
    usbDialog,
    usbLog,
    fileInput,
    say,
    refresh,
    cloudImport,
    syncPlayer,
    syncLabel,
    closeUsb,
    resetUsbDialog,
    connectAndroid,
    openFile,
    selectedPlayer,
    setSelectedPlayer,
  } = useSave();
  const navigate = useNavigate();
  const pathname = useRouterState({ select: (state) => state.location.pathname as TabId });
  const loadedCredential = loaded && credentials.find((c) => c.playerId === loaded.playerId);
  const playerName = loaded && (loadedCredential?.nickname ?? loaded.playerId);
  const tabIds = toolTabs(!!loaded, snapshots.length > 0);
  const activeTab = tabIds.includes(pathname) ? pathname : "/";
  const rememberedId = credentials.some((c) => c.playerId === selectedPlayer)
    ? selectedPlayer
    : credentials[0]?.playerId;
  // A tab that can't show anything yet (e.g. /records after a reload, before a save is opened) goes back to "/".
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigate isn't wrapped in useCallback (the project relies on the React Compiler instead), so listing it would re-run this every render.
  useEffect(() => {
    // Only for the tool's own tabs: while following a link out (e.g. to /charts/$id) this layout briefly sees the new path.
    if (storageReady && pathname in TAB_LABEL && pathname !== "/charts" && pathname !== activeTab)
      void navigate({ to: activeTab, replace: true });
  }, [storageReady, pathname, activeTab]);
  return (
    <>
      <a className="skip-link" href="#results">
        Skip to content
      </a>
      <SiteHeader>
        {loaded && (
          <div className="player-area">
            {loadedCredential && (
              <button
                type="button"
                className={`arrow-row sync-row${sync?.playerId === loadedCredential.playerId ? ` sync-${sync.state}` : ""}`}
                disabled={busy}
                aria-live="polite"
                title={`Fetch the newest cloud save · last fetched ${new Date(loaded.document.source.importedAt).toLocaleString()}`}
                onClick={() => void syncPlayer(loadedCredential)}
              >
                <span className="sync-label">
                  {syncLabel(loadedCredential.playerId, "Sync Now")}
                </span>
                <span className="arrow-chip">
                  <SyncIcon spinning={sync?.state === "syncing"} />
                </span>
              </button>
            )}
            {sync?.state === "error" && sync.playerId === loadedCredential?.playerId && (
              <button
                type="button"
                className="sync-fix"
                onClick={() => dialog.current?.showModal()}
              >
                Re-enter token
              </button>
            )}
            <div
              className="player-tag"
              title={loaded.playerId ? `Player ${loaded.playerId}` : undefined}
            >
              <Avatar
                className="player-avatar"
                name={loaded.document.profile?.avatar || loaded.document.summary?.avatar || ""}
              />
              <span className="player-name">{playerName || "Local save"}</span>
              <span className="player-rks">
                <span className="sr-only">RKS </span>
                {calculateRanking(loaded.document).rankingScore.toFixed(2)}
              </span>
            </div>
          </div>
        )}
      </SiteHeader>
      <main id="overview" className="app-shell">
        <section
          id="import"
          className={`import-band${loaded ? " compact" : ""}`}
          aria-labelledby="import-heading"
        >
          <div className="import-heading">
            <h2 id="import-heading">Import Save</h2>
            <p>Load your Phigros progress</p>
          </div>
          <button
            id="connect"
            className="arrow-row import-option"
            type="button"
            disabled={busy}
            onClick={() => void connectAndroid()}
          >
            <span>
              <strong>Android (USB)</strong>
              <span className="import-description">Connect phone and fetch cloud save</span>
            </span>
            <span className="arrow-chip">
              <Arrow />
            </span>
          </button>
          <button
            id="openToken"
            className="arrow-row import-option"
            type="button"
            onClick={() => dialog.current?.showModal()}
          >
            <span>
              <strong>Session token</strong>
              <span className="import-description">Paste Phigros session token</span>
            </span>
            <span className="arrow-chip">
              <Arrow />
            </span>
          </button>
          <label className="arrow-row import-option file">
            <span>
              <strong>Local file</strong>
              <span className="import-description">Select ZIP or JSON file</span>
            </span>
            <span className="arrow-chip">
              <Arrow />
            </span>
            <input
              ref={fileInput}
              id="file"
              aria-label="Open local ZIP or JSON"
              type="file"
              accept=".zip,.json,application/zip,application/json"
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = "";
                if (file) void openFile(file);
              }}
            />
          </label>
        </section>
        <dialog
          ref={usbDialog}
          id="usbDialog"
          aria-labelledby="usb-heading"
          aria-describedby="usb-help"
          onClose={resetUsbDialog}
        >
          <h2 id="usb-heading">Connect Android</h2>
          <p id="usb-help" className="meta">
            Select your phone in the browser prompt. On your Android device, tap{" "}
            <strong>Allow USB debugging</strong> when asked.
          </p>
          <div
            ref={usbLog}
            className="usb-progress"
            role="log"
            aria-label="Connection progress"
            aria-live="polite"
          >
            {usbEvents.map((event, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only log, entries are never reordered or removed.
              <p key={index}>{event}</p>
            ))}
          </div>
          {usbPhase === "done" && <p className="usb-done meta">Closing in 5 seconds…</p>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={closeUsb}>
              {usbPhase === "connecting" ? "Cancel import" : "Close"}
            </button>
          </div>
        </dialog>
        <dialog ref={dialog} id="tokenDialog">
          <form method="dialog" className="dialog-head">
            <h2>Session Token</h2>
            {/* biome-ignore lint/a11y/useButtonType: the default submit type is intentional; submitting a method="dialog" form is how this button closes the dialog without JS. */}
            <button className="dialog-close" aria-label="Close session token dialog">
              ×
            </button>
          </form>
          <p className="meta">
            Your token is sent straight from this browser to the game’s own TapTap cloud
            (tapapis.com).
          </p>
          {credentials.length > 0 && (
            <div className="dialog-field">
              <label htmlFor="remembered" className="field-label">
                Remembered player
              </label>
              <div className="dialog-row">
                <select
                  id="remembered"
                  className="select-field"
                  value={rememberedId}
                  onChange={(e) => setSelectedPlayer(e.target.value)}
                >
                  {credentials.map((c) => (
                    <option key={c.playerId} value={c.playerId}>
                      {c.nickname ? `${c.nickname} · ` : ""}
                      {c.playerId}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() => {
                    const c = credentials.find((item) => item.playerId === rememberedId);
                    if (c) {
                      dialog.current?.close();
                      void cloudImport(async () => c);
                    }
                  }}
                >
                  Reconnect
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-danger"
                  onClick={() => {
                    const id = rememberedId;
                    if (
                      id &&
                      confirm(
                        "Forget this player's saved session token? Your local snapshots will remain.",
                      )
                    )
                      void deleteCredential(id)
                        .then(refresh)
                        .catch((e) => say(`✗ ${message(e)}`));
                  }}
                >
                  Forget saved token
                </button>
              </div>
            </div>
          )}
          <div className="dialog-field">
            <label htmlFor="token" className="field-label">
              Session token
            </label>
            <div className="dialog-row">
              <input
                id="token"
                required
                className="field"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder="Paste session token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
              <button
                id="useToken"
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  const value = token.trim();
                  setToken("");
                  if (!value)
                    return document.querySelector<HTMLInputElement>("#token")?.reportValidity();
                  dialog.current?.close();
                  void cloudImport(async () => ({ token: value }));
                }}
              >
                Fetch save <Arrow />
              </button>
            </div>
          </div>
        </dialog>

        <div id="results">
          {unsupportedZip ? (
            <div className="panel">
              <p className="warning">This ZIP uses an unsupported save format.</p>
              <button
                type="button"
                className="btn"
                onClick={() => download(unsupportedZip.name, unsupportedZip.bytes)}
              >
                Download original ZIP
              </button>
            </div>
          ) : (
            <Outlet />
          )}
        </div>

        <div id="log" role="status" aria-live="polite" hidden={!log.startsWith("✗")}>
          {log}
        </div>
      </main>
    </>
  );
}
