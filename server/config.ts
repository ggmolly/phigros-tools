import { existsSync } from "node:fs";
import * as v from "valibot";

const configSchema = v.object({
  hash_secret: v.optional(v.string(), "dev-secret"),
  // where new top 10 chart places are posted (server/discord.ts), none in dev
  discord_webhook: v.optional(v.string()),
  // lets the worker ask GitHub about the catalog's mods more than 60 times an hour (server/mods.ts)
  github_token: v.optional(v.string()),
  // the public keys (hex) of the players who see /admin (server/admin.ts)
  admins: v.optional(v.array(v.string()), []),
});

const path = "./data/config.toml";
const raw = existsSync(path) ? Bun.TOML.parse(await Bun.file(path).text()) : {};

export const config = v.parse(configSchema, raw);
// the cookie that names an admin is signed with the secret (server/session.ts): the default one is no secret
if (config.admins.length && config.hash_secret === "dev-secret")
  throw new Error("admins need a hash_secret of their own in data/config.toml");
