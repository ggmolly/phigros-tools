import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { renderRoomCard } from "../../../card";
import { roomPage } from "../../../rooms";

// a room's card, the image of its page's link previews (<id>.jpg)
export default defineHandler(async (event) => {
  const id = /^(\w+)\.jpg$/.exec(getRouterParam(event, "file")!)?.[1];
  const page = id && roomPage(id.toUpperCase());
  if (!page) throw HTTPError.status(404);
  const jpeg = await renderRoomCard(new URL(event.req.url).origin, page);
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
  });
});
