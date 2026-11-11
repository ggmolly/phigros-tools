import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { renderReplayCard } from "../../../card";
import { replayInfo } from "../../../replays";

// a replay's card, the image of its page's link previews (<sha256>.jpg)
export default defineHandler(async (event) => {
  const id = /^([0-9a-f]{64})\.jpg$/.exec(getRouterParam(event, "file")!)?.[1];
  const info = id && replayInfo(id);
  if (!info) throw HTTPError.status(404);
  const jpeg = await renderReplayCard(new URL(event.req.url).origin, info);
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
  });
});
