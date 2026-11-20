import { existsSync } from "node:fs";
import * as v from "valibot";

const configSchema = v.object({
  hash_secret: v.optional(v.string(), "dev-secret"),
  // where new top 10 chart places are posted (server/discord.ts), none in dev
  discord_webhook: v.optional(v.string()),
  // lets the worker ask GitHub about the catalog's mods more than 60 times an hour (server/mods.ts)
  github_token: v.optional(v.string()),
});

const path = "./data/config.toml";
const raw = existsSync(path) ? Bun.TOML.parse(await Bun.file(path).text()) : {};

export const config = v.parse(configSchema, raw);
