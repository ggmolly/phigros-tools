import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { catalogSong, isLevel, songLevels } from "../../../../../src/catalog";
import { renderPlaysCard } from "../../../../card";
import { chartPlays } from "../../../../replays";

// a chart ranking's card, the image of its page's link previews (<LEVEL>.jpg)
export default defineHandler(async (event) => {
  const song = catalogSong(getRouterParam(event, "id", { decode: true })!);
  const level = /^(\w+)\.jpg$/.exec(getRouterParam(event, "file")!)?.[1];
  if (!song || !level || !isLevel(level) || !songLevels(song.id).includes(level))
    throw HTTPError.status(404);
  const plays = chartPlays(0, song.id, level, 8, 0);
  const jpeg = await renderPlaysCard(new URL(event.req.url).origin, song.id, level, plays);
  return new Response(new Uint8Array(jpeg), {
    headers: { "content-type": "image/jpeg", "cache-control": "public, max-age=3600" },
  });
});
