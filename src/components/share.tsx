import { useEffect, useRef, useState } from "react";
import { useT } from "../i18n";
import type { RankingResult } from "../metrics";
import type { SongRecord } from "../modules";
import { currentPalette } from "../palettes";

const SITE_URL = "https://phigros.tools";
export const DEFAULT_NAME = "Unnamed Pigeon";
export type CardFormat = "info" | "b30" | "fc30";
export const CARD_SIZE: Record<CardFormat, { width: number; height: number }> = {
  info: { width: 1600, height: 900 },
  b30: { width: 1600, height: 2150 },
  fc30: { width: 1600, height: 2150 },
};

function ShareIcon() {
  return (
    <svg
      className="button-arrow"
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="square"
      strokeLinejoin="miter"
    >
      <path d="M12 15V3m-5 5 5-5 5 5M5 13v8h14v-8" />
    </svg>
  );
}

export function ShareCard({
  ranking,
  songs,
  playerName,
  avatar,
  challenge,
}: {
  ranking: RankingResult;
  songs: SongRecord[];
  playerName?: string;
  challenge: number;
  /** In-game avatar name. */
  avatar: string;
}) {
  const t = useT();
  const formats: [CardFormat, string][] = [
    ["info", t.share.playerInfo],
    ["b30", "Best 30"],
    ["fc30", "FC 30"],
  ];
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(playerName ?? "");
  const [format, setFormat] = useState<CardFormat>("info");
  const [image, setImage] = useState<{ url: string; blob: Blob }>();
  const [status, setStatus] = useState("");
  const [canShare, setCanShare] = useState(false);
  const rks = ranking.rankingScore.toFixed(3);
  const file =
    image && new File([image.blob], `phigros-${format}-rks-${rks}.png`, { type: "image/png" });
  const caption = t.share.caption(rks, SITE_URL);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | undefined;
    const timer = setTimeout(async () => {
      try {
        const { renderShareCard } = await import("./share-render"); // satori + resvg: only downloaded once the dialog opens
        const blob = await renderShareCard(format, {
          name: name.trim(),
          ranking,
          songs,
          date: new Date(),
          palette: currentPalette(),
          avatar,
          challenge,
        });
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImage({ url, blob });
        const probe = new File([blob], "card.png", { type: "image/png" });
        setCanShare(
          typeof navigator.canShare === "function" && navigator.canShare({ files: [probe] }),
        );
      } catch (error) {
        console.error("share card:", error);
        if (!cancelled) setStatus(t.share.drawFailed);
      }
    }, 150); // debounce typing in the name field
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, name, format, ranking, songs, avatar, challenge, t]);

  async function copy() {
    if (!image) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]);
      setStatus(t.share.copied);
    } catch {
      setStatus(t.share.copyBlocked);
    }
  }
  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: t.share.shareTitle, text: caption });
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setStatus(t.share.shareFailed);
    }
  }

  return (
    <>
      <button
        type="button"
        className="btn hero-share"
        onClick={() => {
          setStatus("");
          setOpen(true);
          dialog.current?.showModal();
        }}
      >
        {t.share.open} <ShareIcon />
      </button>
      <dialog
        ref={dialog}
        id="shareDialog"
        aria-labelledby="share-heading"
        onClose={() => setOpen(false)}
      >
        <form method="dialog" className="dialog-head">
          <h2 id="share-heading">{t.share.title}</h2>
          {/* biome-ignore lint/a11y/useButtonType: the default submit type is intentional; submitting a method="dialog" form is how this button closes the dialog without JS. */}
          <button className="dialog-close" aria-label={t.share.close}>
            ×
          </button>
        </form>
        {/* biome-ignore lint/a11y/useSemanticElements: same button group as the import dialog's game version. */}
        <div className="seg share-format" role="group" aria-label={t.share.format}>
          {formats.map(([value, label]) => (
            <button
              key={value}
              type="button"
              className="seg-option"
              aria-pressed={format === value}
              onClick={() => {
                setImage(undefined);
                setFormat(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className={`share-preview share-preview-${format}`}>
          {image ? (
            <img
              src={image.url}
              width={CARD_SIZE[format].width}
              height={CARD_SIZE[format].height}
              alt={t.share.alt(name || DEFAULT_NAME, rks)}
            />
          ) : (
            <p className="meta">{t.share.drawing}</p>
          )}
        </div>
        <div className="share-controls">
          <label className="share-name">
            <span className="field-label">{t.share.nameOnCard}</span>
            <input
              className="field"
              value={name}
              maxLength={40}
              placeholder={DEFAULT_NAME}
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <div className="share-actions">
            {canShare && (
              <button type="button" className="btn" disabled={!image} onClick={() => void share()}>
                {t.share.share} <ShareIcon />
              </button>
            )}
            <a
              className={`btn${canShare ? " btn-ghost" : ""}`}
              href={image?.url}
              download={file?.name}
              aria-disabled={!image}
            >
              {t.share.download}
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!image}
              onClick={() => void copy()}
            >
              {t.share.copy}
            </button>
          </div>
        </div>
        <p className="meta share-status" aria-live="polite">
          {status}
        </p>
      </dialog>
    </>
  );
}
