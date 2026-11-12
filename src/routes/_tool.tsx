import { createFileRoute, Link, Outlet, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, useRef } from "react";
import { Arrow } from "../components/arrow";
import { SiteHeader, type TabId, toolTabs } from "../components/chrome";
import { ImportOptions, OtherWaysDialog, TapTapDialog } from "../components/import";
import { SignInDialog } from "../components/phigrospp";
import { Avatar } from "../components/primitives";
import { Rich, useT } from "../i18n";
import { calculateRanking } from "../metrics";
import { message, useSave } from "../save-context";
import { headT, pageLinks } from "../seo";
import { deleteCredential } from "../store";

export const Route = createFileRoute("/_tool")({
  head: ({ match }) => ({ links: pageLinks("/", headT(match).locale) }),
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
    account,
    snapshots,
    credentials,
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
    closeUsb,
    resetUsbDialog,
    openFile,
    selectedPlayer,
    setSelectedPlayer,
  } = useSave();
  const t = useT();
  const navigate = useNavigate();
  const importDialog = useRef<HTMLDialogElement>(null);
  const openImport = () => importDialog.current?.showModal();
  const pathname = useRouterState({ select: (state) => state.location.pathname as TabId });
  const loadedCredential = loaded && credentials.find((c) => c.playerId === loaded.playerId);
  // the open save is the signed-in Phigros++ profile's, known from the page's cookie before storage is read
  const profileSave = !!loaded && account === loaded.playerId;
  const playerName = loaded && (loadedCredential?.nickname ?? loaded.playerId);
  const tabIds = toolTabs(!!loaded, snapshots.length > 0, profileSave);
  const activeTab = tabIds.includes(pathname) ? pathname : "/";
  // the token dialog only knows TapTap logins
  const tokens = credentials.filter((c) => c.token);
  const rememberedId = tokens.some((c) => c.playerId === selectedPlayer)
    ? selectedPlayer
    : tokens[0]?.playerId;
  // A tab that can't show anything yet (e.g. /records after a reload, before a save is opened) goes back to "/".
  // biome-ignore lint/correctness/useExhaustiveDependencies: navigate isn't wrapped in useCallback (the project relies on the React Compiler instead), so listing it would re-run this every render.
  useEffect(() => {
    // Only for the tool's own tabs: while following a link out (e.g. to /charts/$id) this layout briefly sees the new path.
    const anyTab = [...toolTabs(true, true, true), ...toolTabs(true, true, false)];
    if (storageReady && anyTab.includes(pathname) && pathname !== activeTab)
      void navigate({ to: activeTab, replace: true });
  }, [storageReady, pathname, activeTab]);
  const tag = loaded && (
    <>
      <Avatar
        className="player-avatar"
        name={loaded.document.profile?.avatar || loaded.document.summary?.avatar || ""}
      />
      <span className="player-name">{playerName || t.tool.localSave}</span>
      <span className="player-rks">
        <span className="sr-only">RKS </span>
        {calculateRanking(loaded.document).rankingScore.toFixed(2)}
      </span>
    </>
  );
  return (
    <>
      <a className="skip-link" href="#results">
        {t.tool.skip}
      </a>
      <SiteHeader>
        {loaded && (
          <div className="player-area">
            {/* Overview's hero is this same profile strip, larger; one is enough per screen. A Phigros++ profile's
             * leads back to it, and has no Import: its save comes from the game. */}
            {activeTab !== "/" &&
              (profileSave ? (
                <Link to="/" className="player-tag">
                  {tag}
                </Link>
              ) : (
                <div
                  className="player-tag"
                  title={loaded.playerId ? t.tool.player(loaded.playerId) : undefined}
                >
                  {tag}
                </div>
              ))}
            {!profileSave && (
              <button type="button" className="btn btn-ghost import-open" onClick={openImport}>
                {t.menu.import}
              </button>
            )}
          </div>
        )}
      </SiteHeader>
      <main id="overview" className="app-shell">
        {/* With no save open, the main menu's Import entry offers these instead; with one open, the header's
         * Import button does (in a dialog, so the import methods don't push every tab's content down). */}
        {!loaded && unsupportedZip && (
          <section id="import" className="import-band" aria-labelledby="import-heading">
            <div className="import-heading">
              <h2 id="import-heading">{t.menu.importSave}</h2>
              <p>{t.tool.importTagline}</p>
            </div>
            <ImportOptions />
          </section>
        )}
        <dialog ref={importDialog} id="importDialog" aria-labelledby="import-dialog-heading">
          <form method="dialog" className="dialog-head">
            <h2 id="import-dialog-heading">{t.menu.importSave}</h2>
            {/* biome-ignore lint/a11y/useButtonType: the default submit type is intentional; submitting a method="dialog" form is how this button closes the dialog without JS. */}
            <button className="dialog-close" aria-label={t.tool.closeImport}>
              ×
            </button>
          </form>
          <p className="meta">{t.tool.importDialogText}</p>
          {/* Each option opens its own dialog or picker: close this one first (capture runs before their click). */}
          <div className="import-list" onClickCapture={() => importDialog.current?.close()}>
            <ImportOptions />
          </div>
        </dialog>
        <input
          ref={fileInput}
          id="file"
          className="file-input"
          tabIndex={-1}
          aria-hidden="true"
          type="file"
          accept=".zip,.json,application/zip,application/json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = "";
            if (file) void openFile(file);
          }}
        />
        <dialog
          ref={usbDialog}
          id="usbDialog"
          aria-labelledby="usb-heading"
          aria-describedby="usb-help"
          onClose={resetUsbDialog}
        >
          <h2 id="usb-heading">{t.tool.usbTitle}</h2>
          <p id="usb-help" className="meta">
            <Rich text={t.tool.usbHelp} />
          </p>
          <div
            ref={usbLog}
            className="usb-progress"
            role="log"
            aria-label={t.tool.usbProgress}
            aria-live="polite"
          >
            {usbEvents.map((event, index) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: append-only log, entries are never reordered or removed.
              <p key={index}>{event}</p>
            ))}
          </div>
          {usbPhase === "done" && <p className="usb-done meta">{t.tool.closing}</p>}
          <div className="dialog-actions">
            <button type="button" className="btn" onClick={closeUsb}>
              {usbPhase === "connecting" ? t.tool.cancelImport : t.tool.close}
            </button>
          </div>
        </dialog>
        <TapTapDialog />
        <SignInDialog />
        <OtherWaysDialog />
        <dialog ref={dialog} id="tokenDialog">
          <form method="dialog" className="dialog-head">
            <h2>{t.tool.tokenTitle}</h2>
            {/* biome-ignore lint/a11y/useButtonType: the default submit type is intentional; submitting a method="dialog" form is how this button closes the dialog without JS. */}
            <button className="dialog-close" aria-label={t.tool.closeToken}>
              ×
            </button>
          </form>
          <p className="meta">{t.tool.tokenNote}</p>
          {tokens.length > 0 && (
            <div className="dialog-field">
              <label htmlFor="remembered" className="field-label">
                {t.tool.remembered}
              </label>
              <div className="dialog-row">
                <select
                  id="remembered"
                  className="select-field"
                  value={rememberedId}
                  onChange={(e) => setSelectedPlayer(e.target.value)}
                >
                  {tokens.map((c) => (
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
                    const c = tokens.find((item) => item.playerId === rememberedId);
                    if (c) {
                      dialog.current?.close();
                      void cloudImport(async () => ({ ...c, token: c.token! }));
                    }
                  }}
                >
                  {t.tool.reconnect}
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-danger"
                  onClick={() => {
                    const id = rememberedId;
                    if (id && confirm(t.tool.forgetConfirm))
                      void deleteCredential(id)
                        .then(refresh)
                        .catch((e) => say(`✗ ${message(e)}`));
                  }}
                >
                  {t.tool.forget}
                </button>
              </div>
            </div>
          )}
          <div className="dialog-field">
            <label htmlFor="token" className="field-label">
              {t.import.token}
            </label>
            <div className="dialog-row">
              <input
                id="token"
                required
                className="field"
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={t.tool.tokenPlaceholder}
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
                {t.tool.fetchSave} <Arrow />
              </button>
            </div>
          </div>
        </dialog>

        <div id="results">
          {loaded?.document.warnings?.length ? (
            <div className="panel" role="status">
              <p className="warning">{loaded.document.warnings.join(" ")}</p>
            </div>
          ) : undefined}
          {unsupportedZip ? (
            <div className="panel">
              <p className="warning">{t.tool.unsupportedZip}</p>
              <button
                type="button"
                className="btn"
                onClick={() => download(unsupportedZip.name, unsupportedZip.bytes)}
              >
                {t.tool.downloadZip}
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
