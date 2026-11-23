import { createServerFn } from "@tanstack/react-start";
import { serverFetch } from "nitro/app";
import type { Block, Media } from "./mods";
import { CARDS } from "./plays";
import { releaseTag } from "./release";
import { SITE } from "./seo";

/** A release note as the feed lists it. Its media are under /releases/ (scripts/build-releases.ts). */
export interface Release {
  /** Its file's name in releases/, and its page's. */
  slug: string;
  title: string;
  /** The day it's of, as yyyy-mm-dd. */
  date: string;
  /** The Phigros++ version it's the release of, none for a note about the site. */
  phigrospp?: string;
  /**
   * That release changed the app itself: it comes with the Phigros++ Installer, or by patching the game again on
   * iOS. Any other one updates from inside the game.
   */
  installer?: true;
  /** Its text under its title, up to its first heading. */
  summary: string;
  /** The first thing it shows. */
  shown?: Media;
}

/** A release note with what it says, as blocks like a mod's README (server/readme.ts). */
export interface Note extends Release {
  blocks: Block[];
}

/** What `GET /api/releases` answers: the latest release of Phigros++ when known, and the notes, newest first. */
export interface Releases {
  version: string | null;
  notes: Release[];
}

/** The link preview image of a note's page (server/card.tsx). */
export const releaseImage = (release: Release) => ({
  url: `${SITE}/og/releases/${release.slug}.jpg`,
  ...CARDS.replay,
  alt: `${release.title}, ${releaseTag(release)}`,
});

const EMPTY: Releases = { version: null, notes: [] };

/** The feed of release notes. */
export const getReleases = createServerFn({ method: "GET" }).handler(async () => {
  const response = await serverFetch("/api/releases");
  return response.ok ? ((await response.json()) as Releases) : EMPTY;
});

/** The latest release of Phigros++ for the footer, null while it isn't known. */
export const getVersion = createServerFn({ method: "GET" }).handler(
  async () => (await getReleases()).version,
);

/** A note with the ones around it in the feed, null for an unknown one. */
export const getRelease = createServerFn({ method: "GET" })
  .validator((slug: string) => slug)
  .handler(async ({ data: slug }) => {
    const [{ notes }, response] = await Promise.all([
      getReleases(),
      serverFetch(`/api/releases/${encodeURIComponent(slug)}`),
    ]);
    if (!response.ok) return null;
    const at = notes.findIndex((note) => note.slug === slug);
    return {
      note: (await response.json()) as Note,
      newer: notes[at - 1] ?? null,
      older: notes[at + 1] ?? null,
    };
  });
