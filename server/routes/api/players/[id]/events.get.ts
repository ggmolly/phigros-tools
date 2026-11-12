import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { listen } from "../../../../events";
import { keyOf } from "../../../../players";

// what changes for a player while their pages are open: their save uploaded, or anything else they show
export default defineHandler((event) => {
  const id = getRouterParam(event, "id")!;
  if (!keyOf(id)) throw HTTPError.status(404);
  return listen(event, id);
});
