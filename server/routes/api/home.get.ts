import { defineHandler, getCookie, HTTPError } from "nitro/h3";
import { home, SESSION, sessionPlayer } from "../../session";

// the signed-in player's save and profile, for the pages rendered with them, 404 without a valid cookie
export default defineHandler(async (event) => {
  const id = sessionPlayer(getCookie(event, SESSION));
  const found = id && (await home(id));
  if (!found) throw HTTPError.status(404);
  return found;
});
