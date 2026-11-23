import { defineHandler } from "nitro/h3";
import * as v from "valibot";
import { topics } from "../../../src/topics";
import { signed, signedJson } from "../../auth";
import { redeemInvite } from "../../devices";
import { announce } from "../../queue";

const Join = v.object({ code: v.string(), name: v.string() });

// a new key joins the profile of the code it typed: { code, name } in, the profile's player out
export default defineHandler(async (event) => {
  const { device, body } = await signed(event);
  const { code, name } = signedJson(Join, body);
  const joined = await redeemInvite(device, code, name);
  await announce(topics.player(joined.id));
  return joined;
});
