import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { importRecords } from "../../records";

// a registered player's records as their game has them, marked imported
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  if (!player(key)) throw HTTPError.status(403, "Not registered");
  return { count: importRecords(key, new TextDecoder().decode(body)) };
});
