import { createServerFn } from "@tanstack/react-start";
import { serverFetch } from "nitro/app";
import type { Block } from "./mods";
import { DOCS, pageMeta, SITE_NAME } from "./seo";

/** A page of the docs as its group lists it, its slug being its path under the docs. */
export interface DocLink {
  slug: string;
  title: string;
  summary: string;
}

/** A page of the docs with what it says. */
export interface Doc {
  title: string;
  summary: string;
  blocks: Block[];
}

/** What every page of the docs shows around it: its groups of pages, and the API's names for the search. */
export interface Docs {
  groups: { title: string; pages: DocLink[] }[];
  symbols: { name: string; page: string; anchor: string }[];
}

/** What's around every page of the docs (scripts/build-docs.ts). */
export const getDocs = createServerFn({ method: "GET" }).handler(async () => {
  const response = await serverFetch("/api/docs");
  return (await response.json()) as Docs;
});

/** The page of the docs at a path, null for none. */
export const getDoc = createServerFn({ method: "GET" })
  .validator((path: string) => path)
  .handler(async ({ data: path }) => {
    const response = await serverFetch(`/api/docs?page=${encodeURIComponent(path)}`);
    return (await response.json()) as Doc | null;
  });

/** A docs page's head: its title, and its address on the docs' own host. */
export function docsHead(title: string, description: string, path: string) {
  const url = path ? `${DOCS}/${path}` : DOCS;
  return {
    meta: pageMeta({ title: SITE_NAME, description, path: "/", locale: "en" }).map((entry) =>
      "title" in entry
        ? { title: `${title} · Phigros++ docs` }
        : entry.property === "og:title"
          ? { ...entry, content: title }
          : entry.property === "og:url"
            ? { ...entry, content: url }
            : entry,
    ),
    links: [{ rel: "canonical", href: url }],
  };
}
