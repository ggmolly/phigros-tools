import { defineHandler } from "nitro/h3";
import { signed } from "../../auth";
import { player, setLook, setName } from "../../players";
import { announce } from "../../queue";

// registers the signing key under its Phigros name, or follows a rename, and keeps what its profile shows:
// { name, intro, avatar, background, unlisted } in, { id, name, number, avatar } out. a refused name changes nothing
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const profile = JSON.parse(new TextDecoder().decode(body)) as Record<string, unknown>;
  const { id } = setName(key, String(profile.name));
  setLook(key, {
    intro: String(profile.intro ?? ""),
    avatar: String(profile.avatar ?? ""),
    background: String(profile.background ?? ""),
    unlisted: profile.unlisted === true,
  });
  await announce(id, "change");
  return player(key);
});
