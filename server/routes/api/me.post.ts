import { defineHandler, HTTPError } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { savedAt } from "../../saves";

// the signing key's player, or 404 when it isn't registered. phrase says whether it signed with the profile's own key
// (a device added with a code has no recovery phrase), save and offer when the uploaded save and the one sent from the
// site were stored (ms)
export default defineHandler(async (event) => {
  const { key, device } = await signed(event);
  const found = player(key);
  if (!found) throw HTTPError.status(404);
  return {
    ...found,
    phrase: Buffer.from(key).equals(device),
    save: savedAt(found.id, "saves") ?? null,
    offer: savedAt(found.id, "offers") ?? null,
  };
});
