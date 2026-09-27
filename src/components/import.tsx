import { useRef, useState } from "react";
import { useSave } from "../save-context";
import { Arrow } from "./arrow";

/** The three import methods as arrow rows, shared by the import band and the main menu's Import entry.
 * "Local file" clicks the page's one hidden #file input (rendered by the tool layout). */
export function ImportOptions() {
  const { dialog, busy, connectAndroid, fileInput } = useSave();
  return (
    <>
      <button
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
      <button
        className="arrow-row import-option"
        type="button"
        onClick={() => fileInput.current?.click()}
      >
        <span>
          <strong>Local file</strong>
          <span className="import-description">Select ZIP or JSON file</span>
        </span>
        <span className="arrow-chip">
          <Arrow />
        </span>
      </button>
    </>
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
export function ImportGuide({ className = "btn btn-ghost" }: { className?: string }) {
  const { dialog: tokenDialog, connectAndroid, busy } = useSave();
  const guide = useRef<HTMLDialogElement>(null);
  const [platform, setPlatform] = useState<Platform>("android");
  return (
    <>
      <button
        type="button"
        className={className}
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
