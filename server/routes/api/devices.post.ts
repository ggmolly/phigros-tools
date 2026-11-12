import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { listDevices } from "../../devices";
import { player } from "../../players";

// the keys signed in to the signing device's profile
export default defineHandler(async (event) => {
  const { key, device } = await signed(event);
  if (!player(key)) throw HTTPError.status(403, "Not registered");
  return listDevices(key, device);
});
