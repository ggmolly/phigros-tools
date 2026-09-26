import { useEffect, useRef, useState } from "react";
import type { RankingResult } from "../metrics";
import type { SongRecord } from "../modules";
import { currentPalette } from "../palettes";

const SITE_URL = "https://phigros.tools";
export const DEFAULT_NAME = "Unnamed Pigeon";
export const W = 1600;
export const H = 900;

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
}: {
  ranking: RankingResult;
  songs: SongRecord[];
  playerName?: string;
  /** In-game avatar name. */
  avatar: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(playerName ?? "");
  const [image, setImage] = useState<{ url: string; blob: Blob }>();
  const [status, setStatus] = useState("");
  const [canShare, setCanShare] = useState(false);
  const rks = ranking.rankingScore.toFixed(3);
  const file = image && new File([image.blob], `phigros-rks-${rks}.png`, { type: "image/png" });
  const caption = `My Phigros RKS is ${rks}! Check yours at ${SITE_URL}`;

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let url: string | undefined;
    const timer = setTimeout(async () => {
      try {
        const { renderShareCard } = await import("./share-render"); // satori + resvg: only downloaded once the dialog opens
        const blob = await renderShareCard({
          name: name.trim(),
          ranking,
          songs,
          date: new Date(),
          palette: currentPalette(),
          avatar,
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
        if (!cancelled) setStatus("Couldn't draw the card. Check your connection and try again.");
      }
    }, 150); // debounce typing in the name field
    return () => {
      cancelled = true;
      clearTimeout(timer);
      if (url) URL.revokeObjectURL(url);
    };
  }, [open, name, ranking, songs, avatar]);

  async function copy() {
    if (!image) return;
    try {
      await navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]);
      setStatus("Image copied to clipboard.");
    } catch {
      setStatus("Your browser blocked copying images. Use Download instead.");
    }
  }
  async function share() {
    if (!file) return;
    try {
      await navigator.share({ files: [file], title: "My Phigros profile", text: caption });
    } catch (error) {
      if ((error as DOMException).name !== "AbortError")
        setStatus("Sharing failed. Use Download instead.");
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
        Share card <ShareIcon />
      </button>
      <dialog
        ref={dialog}
        id="shareDialog"
        aria-labelledby="share-heading"
        onClose={() => setOpen(false)}
      >
        <form method="dialog" className="dialog-head">
          <h2 id="share-heading">Share Card</h2>
          {/* biome-ignore lint/a11y/useButtonType: the default submit type is intentional; submitting a method="dialog" form is how this button closes the dialog without JS. */}
          <button className="dialog-close" aria-label="Close share card dialog">
            ×
          </button>
        </form>
        <div className="share-preview">
          {image ? (
            <img
              src={image.url}
              width={W}
              height={H}
              alt={`Share card: ${name || DEFAULT_NAME}, RKS ${rks}, top charts`}
            />
          ) : (
            <p className="meta">Drawing your card…</p>
          )}
        </div>
        <div className="share-controls">
          <label className="share-name">
            <span className="field-label">Name on card</span>
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
                Share <ShareIcon />
              </button>
            )}
            <a
              className={`btn${canShare ? " btn-ghost" : ""}`}
              href={image?.url}
              download={file?.name}
              aria-disabled={!image}
            >
              Download PNG
            </a>
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!image}
              onClick={() => void copy()}
            >
              Copy image
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
