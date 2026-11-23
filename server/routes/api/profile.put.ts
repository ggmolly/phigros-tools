import { defineHandler } from "nitro/h3";
import * as v from "valibot";
import { topics } from "../../../src/topics";
import { signed, signedJson } from "../../auth";
import { player, setLook, setName } from "../../players";
import { announce } from "../../queue";

// the game leaves out what the player didn't fill in
const Profile = v.object({
  name: v.string(),
  intro: v.optional(v.string(), ""),
  avatar: v.optional(v.string(), ""),
  background: v.optional(v.string(), ""),
  unlisted: v.optional(v.boolean(), false),
});

// registers the signing key under its Phigros name, or follows a rename, and keeps what its profile shows:
// { name, intro, avatar, background, unlisted } in, { id, name, number, avatar } out. a refused name changes nothing
export default defineHandler(async (event) => {
  const { key, body } = await signed(event);
  const { name, ...look } = signedJson(Profile, body);
  const { id } = await setName(key, name);
  await setLook(key, look);
  // the name, avatar and listing show on the rankings
  await Promise.all([announce(topics.player(id)), announce(topics.ranking)]);
  return player(key);
});
