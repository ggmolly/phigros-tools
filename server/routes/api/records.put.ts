import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { announce } from "../../queue";
import { importRecords } from "../../records";

// a registered player's records as their game has them, marked imported
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const found = player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  const count = importRecords(key, new TextDecoder().decode(body));
  await announce(found.id, "change");
  return { count };
});
