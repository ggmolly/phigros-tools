import { defineHandler } from "nitro/h3";
import { signed } from "../../auth";
import { removeDevice } from "../../devices";

// signs a device of the profile out for good, by its key in hex
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  removeDevice(key, new TextDecoder().decode(body));
  return { ok: true };
});
