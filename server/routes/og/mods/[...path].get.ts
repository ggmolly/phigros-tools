import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { renderModCard, renderModsCard } from "../../../card";
import { listedMods } from "../../../mods";

// the cards of the mod catalog's link previews: list.jpg for the catalog, <owner>/<name>.jpg for a mod's page
export default defineHandler(async (event) => {
  const path = getRouterParam(event, "path") ?? "";
  const origin = new URL(event.req.url).origin;
  const mods = listedMods();
  const mod = mods.find(({ repo }) => path === `${repo}.jpg`);
  if (!mod && path !== "list.jpg") throw HTTPError.status(404);
  const jpeg = mod ? await renderModCard(origin, mod) : await renderModsCard(origin, mods);
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
  });
});
