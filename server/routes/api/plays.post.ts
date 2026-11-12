import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { addPlays } from "../../profiles";
import { announce } from "../../queue";

// a registered player's finished songs, the summaries their game sends for their stats
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const found = player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  const count = addPlays(key, new TextDecoder().decode(body));
  await announce(found.id, "change");
  return { count };
});
