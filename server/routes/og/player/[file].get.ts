import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { renderPlayerCard } from "../../../card";
import { profilePage } from "../../../profiles";

// a player's card, the image of their page's link previews (<id>.jpg)
export default defineHandler(async (event) => {
  const id = /^([0-9a-f]+)\.jpg$/.exec(getRouterParam(event, "file")!)?.[1];
  const profile = id && profilePage(id);
  if (!profile) throw HTTPError.status(404);
  const jpeg = await renderPlayerCard(new URL(event.req.url).origin, profile);
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
  });
});
