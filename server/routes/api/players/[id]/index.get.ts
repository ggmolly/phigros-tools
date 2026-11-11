import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { profilePage } from "../../../../profiles";

// a player's page, unlisted ones too: their link is how they're found
export default defineHandler((event) => {
  const profile = profilePage(getRouterParam(event, "id")!);
  if (!profile) throw HTTPError.status(404);
  return profile;
});
