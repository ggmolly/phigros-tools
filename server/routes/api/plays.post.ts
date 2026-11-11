import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { addPlays } from "../../profiles";

// a registered player's finished songs, the summaries their game sends for their stats
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  if (!player(key)) throw HTTPError.status(403, "Not registered");
  return { count: addPlays(key, new TextDecoder().decode(body)) };
});
