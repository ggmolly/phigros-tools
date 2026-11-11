import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { replayInfo } from "../../../../replays";

export default defineHandler((event) => {
  const info = replayInfo(getRouterParam(event, "id")!);
  if (!info) throw HTTPError.status(404);
  return info;
});
