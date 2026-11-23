import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { friendships } from "../../friends";
import { player } from "../../players";

// the friends and requests of the profile a browser is signed in to, as its game shows them (server/friends.ts)
export default defineHandler(async (event) => {
  const { key } = await signed(event);
  if (!player(key)) throw HTTPError.status(403, "Not registered");
  return friendships(key);
});
