import { defineHandler } from "nitro/h3";
import * as v from "valibot";
import { topics } from "../../../src/topics";
import { signed, signedJson } from "../../auth";
import { renameDevice } from "../../devices";
import { playerId } from "../../players";
import { announce } from "../../queue";

const Rename = v.object({ key: v.pipe(v.string(), v.hexadecimal()), name: v.string() });

// a key of the profile gets the name the player gave it: { key (hex), name } in
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const { key: device, name } = signedJson(Rename, body);
  await renameDevice(key, device, name);
  await announce(topics.player(playerId(key)));
  return { ok: true };
});
