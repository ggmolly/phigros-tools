import { defineHandler } from "nitro/h3";
import { topics } from "../../../src/topics";
import { signed } from "../../auth";
import { redeemInvite } from "../../devices";
import { announce } from "../../queue";

// a new key joins the profile of the code it typed: { code, name } in, the profile's player out
export default defineHandler(async (event) => {
  const { device, body } = await signed(event);
  const { code, name } = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  const joined = redeemInvite(device, String(code), String(name));
  await announce(topics.player(joined.id));
  return joined;
});
