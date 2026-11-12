import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { dropOffer } from "../../saves";

// the game loaded or declined the save the player sent from the site
export default defineHandler(async (event) => {
  const found = player((await signed(event)).key);
  if (!found) throw HTTPError.status(403, "Not registered");
  dropOffer(found.id);
  return { ok: true };
});
