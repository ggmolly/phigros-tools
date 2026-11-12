import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { savedSaveFiles } from "../../saves";

// the save the signing key's player uploaded, for their game to load: only they can get it
export default defineHandler(async (event) => {
  const found = player((await signed(event)).key);
  const files = found && savedSaveFiles(found.id);
  if (!files) throw HTTPError.status(404);
  return new Response(files, { headers: { "content-type": "application/octet-stream" } });
});
