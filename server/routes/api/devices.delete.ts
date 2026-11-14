import { defineHandler } from "nitro/h3";
import { topics } from "../../../src/topics";
import { signed } from "../../auth";
import { removeDevice } from "../../devices";
import { playerId } from "../../players";
import { announce } from "../../queue";

// signs a device of the profile out for good, by its key in hex
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  removeDevice(key, new TextDecoder().decode(body));
  await announce(topics.player(playerId(key)));
  return { ok: true };
});
