/** How long the "Link copied" note shows (its animation's length, `copied-note` in player.css). */
export const COPIED_NOTE = 1800;

/**
 * Shares a link: phones get the share sheet, desktop ones (Windows, macOS) are clunkier than a copied link. Resolves
 * true once the link is in the clipboard, for the page to say so.
 */
export async function shareLink(url: string) {
  if (navigator.share && matchMedia("(pointer: coarse)").matches) {
    await navigator.share({ title: document.title, url }).catch(() => undefined); // the sheet was closed
    return false;
  }
  await navigator.clipboard.writeText(url);
  return true;
}
