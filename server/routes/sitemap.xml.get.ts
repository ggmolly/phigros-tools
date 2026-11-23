import { statSync } from "node:fs";
import { defineHandler } from "nitro/h3";
import { catalogSongs } from "../../src/catalog";
import { sitemap, sitemapEntry } from "../../src/seo";
import { GAME_DIR } from "../game";

// the pages meant to be indexed: the tool's own tabs are noindex (src/routes/_tool.*.tsx). each is as old as the
// catalog, and the mods have their own (sitemap-mods.xml.get.ts)
export default defineHandler(() => {
  const day = statSync(`${GAME_DIR}/catalog.json`).mtime.toISOString().slice(0, 10);
  const paths = [
    "/",
    "/start",
    "/charts",
    ...catalogSongs.map((song) => `/charts/${encodeURIComponent(song.id)}`),
  ];
  return new Response(sitemap(paths.map((path) => sitemapEntry(path, day))), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
});
