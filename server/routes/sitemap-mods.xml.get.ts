import { defineHandler } from "nitro/h3";
import { sitemap, sitemapEntry } from "../../src/seo";
import { listedMods } from "../mods";

// the mod catalog's pages, which follow the registry without a deploy: the catalog as of its newest release, then
// each mod's page as of its own
export default defineHandler(() => {
  const mods = listedMods();
  const day = (date: string) => date.slice(0, 10);
  const newest =
    mods
      .map((mod) => day(mod.updated))
      .sort()
      .pop() ?? day(new Date().toISOString());
  const entries = [
    sitemapEntry("/mods", newest),
    ...mods.map((mod) => sitemapEntry(`/mods/${mod.repo}`, day(mod.updated))),
  ];
  return new Response(sitemap(entries), {
    headers: {
      "content-type": "application/xml; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
});
