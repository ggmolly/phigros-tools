import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { storeSave } from "../../saves";

// a save sent from the site for the player's game to offer, packed like the game uploads its own
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const found = player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  await storeSave(found.id, body, "offers");
  return { ok: true };
});
