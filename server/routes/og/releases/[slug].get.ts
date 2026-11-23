import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { renderReleaseCard } from "../../../card";
import { notes } from "../../../releases";

// the card of a release note's link previews: <slug>.jpg
export default defineHandler(async (event) => {
  const file = getRouterParam(event, "slug");
  const note = (await notes()).find(({ slug }) => file === `${slug}.jpg`);
  if (!note) throw HTTPError.status(404);
  const jpeg = await renderReleaseCard(new URL(event.req.url).origin, note);
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
  });
});
