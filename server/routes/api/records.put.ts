import { defineHandler, HTTPError } from "nitro/h3";
import { topics } from "../../../src/topics";
import { signed } from "../../auth";
import { player } from "../../players";
import { announce } from "../../queue";
import { importRecords } from "../../records";

// a registered player's records as their game has them, marked imported, answered with the bests the game lacks
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const found = await player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  const { count, raised, better } = await importRecords(key, new TextDecoder().decode(body));
  await Promise.all([
    announce(topics.player(found.id)),
    ...raised.map(({ song, level }) => announce(topics.chart(song, level))),
    raised.length > 0 && announce(topics.ranking),
  ]);
  return { count, better };
});
