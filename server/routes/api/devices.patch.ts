import { defineHandler } from "nitro/h3";
import { signed } from "../../auth";
import { renameDevice } from "../../devices";

// a key of the profile gets the name the player gave it: { key (hex), name } in
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const { key: device, name } = JSON.parse(new TextDecoder().decode(body)) as Record<
    string,
    unknown
  >;
  renameDevice(key, String(device), String(name));
  return { ok: true };
});
