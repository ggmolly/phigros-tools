import { useEffect, useRef, useState } from "react";
import { encode } from "uqr";
import { Rich, useT } from "../i18n";
import type { Region } from "../save";
import { message, useSave } from "../save-context";
import type { LoginCode, LoginStatus } from "../taptap";
import { Arrow } from "./arrow";

/** The import methods as arrow rows, shared by the import band and the main menu's Import entry.
 * "Local file" clicks the page's one hidden #file input (rendered by the tool layout). */
export function ImportOptions() {
  const { dialog, busy, connectAndroid, fileInput, openTapTap } = useSave();
  const t = useT();
  return (
    <>
      <button
        className="arrow-row import-option"
        type="button"
        disabled={busy}
        onClick={() => openTapTap.current?.()}
      >
        <span>
          <strong>{t.import.taptap}</strong>
          <span className="import-description">{t.import.taptapDesc}</span>
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
          <strong>{t.import.usb}</strong>
          <span className="import-description">{t.import.usbDesc}</span>
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
          <strong>{t.import.token}</strong>
          <span className="import-description">{t.import.tokenDesc}</span>
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
          <strong>{t.import.file}</strong>
          <span className="import-description">{t.import.fileDesc}</span>
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
  const t = useT();
  const { data, size } = encode(text, { border: 2 });
  const path = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg className="qr-code" viewBox={`0 0 ${size} ${size}`} shapeRendering="crispEdges">
      <title>{t.import.qrTitle}</title>
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}

/** "Log in with TapTap" (see src/taptap.ts): one dialog for the whole tool, opened through `openTapTap`. */
export function TapTapDialog() {
  const { openTapTap, cloudImport } = useSave();
  const dialog = useRef<HTMLDialogElement>(null);
  const controller = useRef<AbortController>(undefined);
  const [region, setRegion] = useState<Region>("global");
  const [code, setCode] = useState<LoginCode>();
  const [status, setStatus] = useState<LoginStatus | "loading">("loading");
  const [error, setError] = useState("");
  const t = useT();

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
        <h2 id="taptap-heading">{t.import.dialogTitle}</h2>
        {/* biome-ignore lint/a11y/useButtonType: the default submit type closes the method="dialog" form. */}
        <button className="dialog-close" aria-label={t.import.close}>
          ×
        </button>
      </form>
      <p className="meta">
        <Rich text={t.import.intro} />
      </p>
      {/* biome-ignore lint/a11y/useSemanticElements: same button group as DifficultyFilter. */}
      <div className="seg" role="group" aria-label={t.import.gameVersion}>
        {(
          [
            ["global", t.import.global],
            ["china", t.import.china],
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
              <span className="meta">{t.import.code}</span> <strong>{code.userCode}</strong>
            </p>
          )}
          <p role="status" className={error ? "negative" : "meta"}>
            {error || t.import[status]}
          </p>
          {error ? (
            <button type="button" className="btn" onClick={() => void start(region)}>
              {t.import.newCode} <Arrow />
            </button>
          ) : (
            code && (
              <a className="btn" href={code.url} target="_blank" rel="noopener noreferrer">
                {t.import.openTapTap} <Arrow />
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
  const t = useT();
  return (
    <>
      <button type="button" className={className} onClick={() => guide.current?.showModal()}>
        {t.import.guideButton} <Arrow />
      </button>
      <dialog ref={guide} id="guideDialog" aria-labelledby="guide-heading">
        <form method="dialog" className="dialog-head">
          <h2 id="guide-heading">{t.import.guideTitle}</h2>
          {/* biome-ignore lint/a11y/useButtonType: the default submit type closes the method="dialog" form. */}
          <button className="dialog-close" aria-label={t.import.guideClose}>
            ×
          </button>
        </form>
        <p className="meta">
          <Rich text={t.import.guideIntro} />
        </p>
        <ol className="guide-steps">
          <li>
            <Rich text={t.import.step1} />
          </li>
          <li>
            <Rich text={t.import.step2} />
          </li>
          <li>
            <Rich text={t.import.step3} />
          </li>
        </ol>
        <details className="guide-more">
          <summary>{t.import.usbSummary}</summary>
          <ol className="guide-steps">
            <li>
              <Rich text={t.import.usb1} />
            </li>
            <li>
              <Rich text={t.import.usb2} />
            </li>
            <li>
              <Rich text={t.import.usb3} />
            </li>
            <li>
              <Rich text={t.import.usb4} />
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
            {t.import.loginWithTapTap} <Arrow />
          </button>
        </div>
      </dialog>
    </>
  );
}
