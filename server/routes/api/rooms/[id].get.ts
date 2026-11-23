import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { roomPage } from "../../../rooms";

// a room and the matches it played
export default defineHandler(async (event) => {
  const page = await roomPage(getRouterParam(event, "id")!.toUpperCase());
  if (!page) throw HTTPError.status(404);
  return page;
});
