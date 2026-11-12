import { Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Rich, useFormat, useT } from "../i18n";
import { calculateRanking } from "../metrics";
import type { Device } from "../phigrospp";
import { message, useSave } from "../save-context";
import type { Credential } from "../store";
import { Arrow } from "./arrow";
import { DATE_TIME } from "./history-panels";

/** The Phigros++ profile this browser is signed in to that the open save belongs to, if any. */
export function useProfileCredential(): Credential | undefined {
  const { loaded, credentials } = useSave();
  return credentials.find((c) => c.signer && c.playerId === loaded?.playerId);
}

/** Sign in with a code from the game, or with the recovery phrase. One dialog for the tool, opened through `openSignIn`. */
export function SignInDialog() {
  const { openSignIn, signIn } = useSave();
  const dialog = useRef<HTMLDialogElement>(null);
  const [phrase, setPhrase] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const t = useT();
  useEffect(() => {
    openSignIn.current = () => {
      setError("");
      dialog.current?.showModal();
    };
  }, [openSignIn]);
  async function submit(form: HTMLFormElement) {
    const value = String(new FormData(form).get("value") ?? "").trim();
    setBusy(true);
    setError("");
    try {
      await signIn(phrase ? { phrase: value } : { code: value });
      dialog.current?.close();
      form.reset();
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <dialog ref={dialog} id="signInDialog" aria-labelledby="sign-in-heading">
      <form method="dialog" className="dialog-head">
        <h2 id="sign-in-heading">{phrase ? t.ppp.phraseTitle : t.ppp.signInTitle}</h2>
        {/* biome-ignore lint/a11y/useButtonType: the default submit type closes the method="dialog" form. */}
        <button className="dialog-close" aria-label={t.ppp.close}>
          ×
        </button>
      </form>
      <form
        className="sign-in"
        onSubmit={(e) => {
          e.preventDefault();
          void submit(e.currentTarget);
        }}
      >
        {phrase ? (
          <p className="meta">
            <Rich text={t.ppp.phraseText} />
          </p>
        ) : (
          <ol className="guide-steps">
            <li>
              <Rich text={t.ppp.signInStep1} />
            </li>
            <li>{t.ppp.signInStep2}</li>
          </ol>
        )}
        <label htmlFor="sign-in-value" className="field-label">
          {phrase ? t.ppp.phrase : t.ppp.code}
        </label>
        {phrase ? (
          <textarea
            id="sign-in-value"
            name="value"
            className="field phrase-field"
            required
            rows={4}
            autoComplete="off"
            spellCheck={false}
          />
        ) : (
          <input
            id="sign-in-value"
            name="value"
            className="field code-field"
            required
            autoComplete="one-time-code"
            spellCheck={false}
            placeholder="XXXX XXXX"
          />
        )}
        {phrase && <p className="meta small">{t.ppp.phraseNote}</p>}
        <p role="status" className="negative" hidden={!error}>
          {error}
        </p>
        <div className="dialog-actions sign-in-actions">
          <button type="button" className="text-link" onClick={() => setPhrase(!phrase)}>
            {phrase ? t.ppp.useCode : t.ppp.usePhrase}
          </button>
          <button type="submit" className="btn" disabled={busy}>
            {busy ? t.ppp.signingIn : t.ppp.signIn} <Arrow />
          </button>
        </div>
      </form>
    </dialog>
  );
}

/** Sends a save's original zip to the signed-in Phigros++ profile after asking, or undefined when there's none. */
export function useSendToPhigrospp(): ((rawZip: Uint8Array) => void) | undefined {
  const { credentials, sendToPhigrospp, say } = useSave();
  const t = useT();
  const target = credentials.find((c) => c.signer);
  if (!target) return undefined;
  return (rawZip) => {
    if (!confirm(t.ppp.sendConfirm(target.nickname ?? target.playerId))) return;
    sendToPhigrospp(rawZip, target).then(
      () => say(`✓ ${t.ppp.sent}`),
      (e) => say(`✗ ${message(e)}`),
    );
  };
}

/** Overview's first band for a save that only lives in this browser: the way to move it to Phigros++, step by step
 * until a profile is signed in. On a Phigros++ save, a line points back to a better one kept here (a TapTap save, say). */
export function PhigrosppBar() {
  const { loaded, snapshots, credentials, openSignIn, openSnapshot } = useSave();
  const credential = useProfileCredential();
  const send = useSendToPhigrospp();
  const t = useT();
  const format = useFormat();
  if (!loaded) return null;
  if (credential) {
    const rks = calculateRanking(loaded.document).rankingScore;
    const better = snapshots.find(
      (s) =>
        s.rawZip &&
        !credentials.some((c) => c.signer && c.playerId === s.playerId) &&
        calculateRanking(s.document).rankingScore > rks,
    );
    return better ? (
      <p className="ppp-cta">
        {t.ppp.olderSave(
          format.date(better.capturedAt),
          calculateRanking(better.document).rankingScore.toFixed(2),
        )}{" "}
        <button type="button" className="text-link" onClick={() => void openSnapshot(better)}>
          {t.ppp.openIt}
        </button>
      </p>
    ) : null;
  }
  const rawZip = loaded.archive?.rawZip;
  if (!rawZip) return null;
  return (
    <section className="panel ppp-bar">
      <div className="ppp-bar-text">
        <p>{t.ppp.move}</p>
        {!send && (
          <ol className="guide-steps">
            {[t.ppp.moveStep1, t.ppp.moveStep2, t.ppp.moveStep3].map((step) => (
              <li key={step}>
                <Rich text={step} />
              </li>
            ))}
          </ol>
        )}
      </div>
      {send ? (
        <button type="button" className="btn" onClick={() => send(rawZip)}>
          {t.ppp.send} <Arrow />
        </button>
      ) : (
        <div className="ppp-bar-actions">
          <Link to="/phigrospp" className="btn">
            {t.ppp.get} <Arrow />
          </Link>
          <button type="button" className="btn btn-ghost" onClick={() => openSignIn.current?.()}>
            {t.ppp.signIn}
          </button>
        </div>
      )}
    </section>
  );
}

/** The keys signed in to the open profile, with a code to add one and a way to remove each. */
export function DevicesPanel({ credential }: { credential: Credential }) {
  const { say, signOut } = useSave();
  const t = useT();
  const format = useFormat();
  const [devices, setDevices] = useState<Device[]>();
  const [invite, setInvite] = useState<{ code: string; expires: number }>();
  const [editing, setEditing] = useState<string>();
  async function load() {
    const ppp = await import("../phigrospp");
    setDevices(
      await ppp.answer<Device[]>(await ppp.call(credential.signer!, "POST", "/api/devices")),
    );
  }
  // biome-ignore lint/correctness/useExhaustiveDependencies: loads once per profile; load isn't wrapped in useCallback (the React Compiler handles memoisation).
  useEffect(() => {
    load().catch((e) => say(`✗ ${message(e)}`));
  }, [credential.playerId]);
  async function addDevice() {
    const ppp = await import("../phigrospp");
    setInvite(await ppp.answer(await ppp.call(credential.signer!, "POST", "/api/invite")));
  }
  async function rename(device: Device, name: string) {
    setEditing(undefined);
    if (name.trim() === device.name) return;
    const ppp = await import("../phigrospp");
    await ppp.answer(
      await ppp.call(
        credential.signer!,
        "PATCH",
        "/api/devices",
        JSON.stringify({ key: device.key, name }),
      ),
    );
    await load();
  }
  async function remove(device: Device) {
    if (!confirm(t.ppp.removeConfirm(device.name))) return;
    const ppp = await import("../phigrospp");
    await ppp.answer(await ppp.call(credential.signer!, "DELETE", "/api/devices", device.key));
    await load();
  }
  const fail = (e: unknown) => say(`✗ ${message(e)}`);
  return (
    <section className="panel" aria-labelledby="devices-heading">
      <div className="panel-head devices-head">
        <h2 id="devices-heading" className="panel-title">
          {t.ppp.devicesTitle}
        </h2>
        <button type="button" className="btn" onClick={() => void addDevice().catch(fail)}>
          {t.ppp.addDevice} <Arrow />
        </button>
      </div>
      {invite && (
        <div className="device-invite">
          <p className="invite-code">{invite.code.replace(/(.{4})/, "$1 ")}</p>
          <p className="meta">
            <Rich text={t.ppp.addDeviceText} />
          </p>
        </div>
      )}
      <ul className="device-list">
        {devices?.map((device) => (
          <li key={device.key}>
            <span className="device-text">
              {editing === device.key ? (
                <input
                  className="field device-rename"
                  // biome-ignore lint/a11y/noAutofocus: the pen button asked to type the name now.
                  autoFocus
                  defaultValue={device.name}
                  placeholder={device.name}
                  aria-label={t.ppp.rename}
                  maxLength={64}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") setEditing(undefined);
                  }}
                  onBlur={(e) => void rename(device, e.currentTarget.value).catch(fail)}
                />
              ) : (
                <span className="device-name">{device.name}</span>
              )}
              <span className="meta">
                {[
                  device.you && t.ppp.thisBrowser,
                  device.seen > 0 && t.ppp.seen(format.date(device.seen, DATE_TIME)),
                  t.ppp.added(format.date(device.added)),
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </span>
            {device.you && (
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => confirm(t.ppp.signOutConfirm) && void signOut(credential)}
              >
                {t.ppp.signOut}
              </button>
            )}
            {!device.you && (
              <button
                type="button"
                className="btn btn-ghost btn-danger"
                onClick={() => void remove(device).catch(fail)}
              >
                {t.ppp.remove}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost device-pen"
              aria-label={t.ppp.rename}
              title={t.ppp.rename}
              onClick={() => setEditing(device.key)}
            >
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
              </svg>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
