import { statSync } from "node:fs";
import { defineHandler } from "nitro/h3";
import { catalogSongs } from "../../src/catalog";
import { sitemap, sitemapEntry } from "../../src/seo";
import { GAME_DIR } from "../game";
import { notes } from "../releases";

// the pages meant to be indexed: the tool's own tabs are noindex (src/routes/_tool.*.tsx). each is as old as the
// catalog, songs in English only (englishOnlyMeta in src/seo.ts), and the mods have their own (sitemap-mods.xml.get.ts). then the release notes, their feed as old as its
// newest
export default defineHandler(async () => {
  const day = statSync(`${GAME_DIR}/catalog.json`).mtime.toISOString().slice(0, 10);
  const released = await notes();
  const entries = [
    ...["/", "/start", "/cloud-save", "/phigrospp", "/charts", "/leaderboard", "/rooms"].map((path) =>
      sitemapEntry(path, day),
    ),
    ...catalogSongs.map((song) =>
      sitemapEntry(`/charts/${encodeURIComponent(song.id)}`, day, true),
    ),
    ...released.slice(0, 1).map((note) => sitemapEntry("/releases", note.date)),
    ...released.map((note) => sitemapEntry(`/releases/${note.slug}`, note.date)),
  ];
  return new Response(sitemap(entries), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
});
