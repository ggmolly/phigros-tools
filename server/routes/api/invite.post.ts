import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { createInvite } from "../../devices";
import { player } from "../../players";

// a code another device types to join the signing device's profile: { code, expires }
export default defineHandler(async (event) => {
  const { key } = await signed(event);
  if (!player(key)) throw HTTPError.status(403, "Not registered");
  return createInvite(key);
});
