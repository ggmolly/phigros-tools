import { defineHandler, getQuery, getRouterParam, HTTPError } from "nitro/h3";
import { LIST_MORE } from "../../../../../src/plays";
import { profileList } from "../../../../profiles";

// more of a player's recent plays or activity: ?offset= is how many are already shown
export default defineHandler((event) => {
  const offset = Math.max(0, Math.floor(Number(getQuery(event).offset)) || 0);
  const list = profileList(
    getRouterParam(event, "id")!,
    getRouterParam(event, "list")!,
    offset,
    LIST_MORE,
  );
  if (!list) throw HTTPError.status(404);
  return list;
});
