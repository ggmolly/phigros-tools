import { defineHandler, HTTPError } from "nitro/h3";
import { topics } from "../../../src/topics";
import { signed } from "../../auth";
import { player } from "../../players";
import { announce } from "../../queue";
import { declareRecords } from "../../records";

// the records a registered player typed on the site to rebuild their save, marked declared: they count nowhere
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const found = player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  const count = declareRecords(key, new TextDecoder().decode(body));
  await announce(topics.player(found.id));
  return { count };
});
