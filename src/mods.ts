import { createServerFn } from "@tanstack/react-start";
import { serverFetch } from "nitro/app";
import { CARDS } from "./plays";
import { SITE } from "./seo";

/** A run of a README's text, drawn in one style. */
export interface Span {
  text: string;
  bold?: true;
  italic?: true;
  code?: true;
  /** Where it goes when it's a link: the web, or phigrospp://install/<owner>/<name> for another mod. */
  link?: string;
}

/** Something a README shows, under /catalog/: a poster, and a short muted clip of a video or a GIF. */
export interface Media {
  kind: "media";
  /** Where the README has it and the tag that address gave it, so it's only made again when it changes. */
  src: string;
  etag?: string;
  poster: string;
  clip?: string;
  width: number;
  height: number;
}

/** A part of a mod's README as the game draws it, from /catalog/<repo>/readme.json (server/readme.ts). */
export type Block =
  | { kind: "heading"; level: number; spans: Span[] }
  | { kind: "text"; spans: Span[] }
  | { kind: "quote"; spans: Span[] }
  | { kind: "item"; mark: string; depth: number; spans: Span[] }
  /** A block of code, its language as the fence named it ("lua"), none when it didn't. */
  | { kind: "code"; text: string; lang?: string }
  | { kind: "rule" }
  /** A table of the docs, its first row the header: a README's are lines of text, as the game draws them. */
  | { kind: "table"; rows: Span[][][] }
  | Media;

/** A mod of the Phigros++ catalog as the game and the Mods page read it from /catalog/index.json (server/mods.ts). */
export interface Mod {
  /** owner/name on GitHub, in lowercase. */
  repo: string;
  /** Its README's title, else its repository's name. */
  name: string;
  author: string;
  /** The README's text under its title. */
  description: string;
  /** The tag of its latest signed release, whose asset is `file`. */
  version: string;
  file: "mod.zip" | "mod.lua";
  size: number;
  stars: number;
  /** When that release was published. */
  updated: string;
  /** Under /catalog/, the first thing its README shows. Only a video or a GIF has a clip. */
  poster?: string;
  clip?: string;
  /** The Class.Method of each hook() call, for iOS where hooks are written ahead. null when one couldn't be read. */
  hooks: string[] | null;
}

export const modLink = (repo: string) => `phigrospp://install/${repo}`;

/** The link preview image of a mod's page, or of the catalog's without one (server/card.tsx). */
export const modImage = (mod?: Mod) => ({
  url: `${SITE}/og/mods/${mod ? `${mod.repo}.jpg` : "list.jpg"}`,
  ...CARDS.replay,
  alt: mod ? `${mod.name}, a mod for Phigros++ by ${mod.author}` : "Mods for Phigros++",
});

/** A mod of the catalog with its README, null for a repo it doesn't list. */
export const getMod = createServerFn({ method: "GET" })
  .validator((repo: string) => repo)
  .handler(async ({ data: repo }) => {
    const mod = (await getMods()).find((listed) => listed.repo === repo.toLowerCase());
    if (!mod) return null;
    const readme = await serverFetch(`/catalog/${mod.repo}/readme.json`);
    return { mod, blocks: readme.ok ? ((await readme.json()) as Block[]) : [] };
  });

/** The catalog, empty until the worker listed it. */
export const getMods = createServerFn({ method: "GET" }).handler(async () => {
  const response = await serverFetch("/catalog/index.json");
  return response.ok ? ((await response.json()) as { mods: Mod[] }).mods : [];
});
