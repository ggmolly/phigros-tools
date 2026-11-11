import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";

// the signing key's player, or 404 when it isn't registered
export default defineHandler(async (event) => {
  const found = player((await signed(event)).key);
  if (!found) throw HTTPError.status(404);
  return found;
});
