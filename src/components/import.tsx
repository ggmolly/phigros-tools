import { useEffect, useRef, useState } from "react";
import { encode } from "uqr";
import type { Region } from "../save";
import { message, useSave } from "../save-context";
import type { LoginCode, LoginStatus } from "../taptap";
import { Arrow } from "./arrow";

/** The import methods as arrow rows, shared by the import band and the main menu's Import entry.
 * "Local file" clicks the page's one hidden #file input (rendered by the tool layout). */
export function ImportOptions() {
  const { dialog, busy, connectAndroid, fileInput, openTapTap } = useSave();
  return (
    <>
      <button
        className="arrow-row import-option"
        type="button"
        disabled={busy}
        onClick={() => openTapTap.current?.()}
      >
        <span>
          <strong>TapTap login</strong>
          <span className="import-description">Scan a QR code, on any device</span>
        </span>
        <span className="arrow-chip">
          <Arrow />
        </span>
      </button>
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

/** A QR code as crisp SVG squares (dark on a white tile, which scanners need whatever the theme). */
function QrCode({ text }: { text: string }) {
  const { data, size } = encode(text, { border: 2 });
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg className="qr-code" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <title>Login QR code</title>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

const STATUS_TEXT: Record<LoginStatus | "loading", string> = {
  loading: "Getting a login code…",
  waiting: "Waiting for you to approve it in TapTap…",
  scanned: "Scanned. Approve the login in TapTap.",
  approved: "Approved. Logging in to Phigros…",
};

/** "Log in with TapTap" (see src/taptap.ts): one dialog for the whole tool, opened through `openTapTap`. */
export function TapTapDialog() {
  const { openTapTap, cloudImport } = useSave();
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController>(undefined);
  const [region, setRegion] = useState<Region>("global");
  const [code, setCode] = useState<LoginCode>();
  const [status, setStatus] = useState<LoginStatus | "loading">("loading");
  const [error, setError] = useState("");

  async function start(next: Region) {
    controller.current?.abort();
    const current = new AbortController();
    controller.current = current;
    const { signal } = current;
    setRegion(next);
    setCode(undefined);
    setError("");
    setStatus("loading");
    try {
      const taptap = await import("../taptap");
      const loginCode = await taptap.requestLoginCode(next, signal);
      setCode(loginCode);
      setStatus("waiting");
      const session = await taptap.completeLogin(loginCode, setStatus, signal);
      dialog.current?.close();
      void cloudImport(async () => ({
        token: session.token,
        region: next,
        account: { objectId: session.objectId, nickname: session.nickname },
      }));
    } catch (e) {
      if (!signal.aborted) setError(message(e));
    }
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: start isn't wrapped in useCallback (the React Compiler handles memoisation); this only registers the opener.
  useEffect(() => {
    openTapTap.current = () => {
      dialog.current?.showModal();
      void start(region);
    };
  }, [openTapTap, region]);

  return (
    <dialog
      ref={dialog}
      id="taptapDialog"
      aria-labelledby="taptap-heading"
      onClose={() => controller.current?.abort()}
    >
      <form method="dialog" className="dialog-head">
        <h2 id="taptap-heading">TapTap Login</h2>
        {/* biome-ignore lint/a11y/useButtonType: the default submit type closes the method="dialog" form. */}
        <button className="dialog-close" aria-label="Close TapTap login">
          ×
        </button>
      </form>
      <p className="meta">
        Scan the code with your phone, or tap <strong>Open TapTap</strong> on the phone itself, and
        approve with the TapTap account you play Phigros with.
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: same button group as DifficultyFilter. */}
      <div className="seg" role="group" aria-label="Game version">
        {(
          [
            ["global", "Global"],
            ["china", "China"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            className="seg-option"
            aria-pressed={region === value}
            onClick={() => region !== value && void start(value)}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="taptap-login">
        <div className="qr-slot">{code && !error && <QrCode text={code.url} />}</div>
        <div className="taptap-side">
          {code && (
            <p className="taptap-code">
              <span className="meta">Code</span> <strong>{code.userCode}</strong>
            </p>
          )}
          <p role="status" className={error ? "negative" : "meta"}>
            {error || STATUS_TEXT[status]}
          </p>
          {error ? (
            <button type="button" className="btn" onClick={() => void start(region)}>
              New code <Arrow />
            </button>
          ) : (
            code && (
              <a className="btn" href={code.url} target="_blank" rel="noopener noreferrer">
                Open TapTap <Arrow />
              </a>
            )
          )}
        </div>
      </div>
    </dialog>
  );
}

/** Opt-in walkthrough of the import methods. Nothing forces it open: the site is browsable without a save. */
export function ImportGuide({ className = "btn btn-ghost" }: { className?: string }) {
  const { openTapTap, busy } = useSave();
  const guide = useRef<HTMLDialogElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => guide.current?.showModal()}>
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
          <strong>Sync Now</strong>. Global and China versions of the game both work.
        </p>
        <ol className="guide-steps">
          <li>
            Choose <strong>TapTap login</strong> and pick your game version.
          </li>
          <li>
            Scan the QR code with your phone, or tap <strong>Open TapTap</strong> if you’re on the
            phone already, and approve with the TapTap account you play with.
          </li>
          <li>
            Your save loads, and this browser remembers the login so <strong>Sync</strong> fetches
            newer saves later.
          </li>
        </ol>
        <details className="guide-more">
          <summary>Android over USB instead</summary>
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
        </details>
        <div className="dialog-actions">
          <button
            type="button"
            className="btn"
            disabled={busy}
            onClick={() => {
              guide.current?.close();
              openTapTap.current?.();
            }}
          >
            Log in with TapTap <Arrow />
          </button>
        </div>
      </dialog>
    </>
  );
}
