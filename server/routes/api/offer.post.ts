import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { savedSaveFiles } from "../../saves";

// the save the player sent from the site, for their game to load
export default defineHandler(async (event) => {
  const found = player((await signed(event)).key);
  const files = found && savedSaveFiles(found.id, "offers");
  if (!files) throw HTTPError.status(404);
  return new Response(files, { headers: { "content-type": "application/octet-stream" } });
});
