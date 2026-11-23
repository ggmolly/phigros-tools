import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { replayInfo } from "../../../../replays";

export default defineHandler(async (event) => {
  const info = await replayInfo(getRouterParam(event, "id")!);
  if (!info) throw HTTPError.status(404);
  return info;
});
