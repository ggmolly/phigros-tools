import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { announce } from "../../queue";
import { storeSave } from "../../saves";

// a registered player's whole save and its summary, replacing the one they sent before
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const found = player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  await announce(found.id, "save", String(await storeSave(found.id, body)));
  return { ok: true };
});
