import { defineHandler, getCookie, HTTPError } from "nitro/h3";
import { rolesOf } from "../../admin";
import { home, SESSION, sessionPlayer } from "../../session";

// the signed-in player's save, profile and roles, for the pages rendered with them, 404 without a valid cookie
export default defineHandler(async (event) => {
  const who = await sessionPlayer(getCookie(event, SESSION));
  const found = who && (await home(who.id));
  if (!found) throw HTTPError.status(404);
  return { ...found, roles: rolesOf(who.key) };
});
