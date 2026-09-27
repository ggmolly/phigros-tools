import { existsSync } from "node:fs";
import * as v from "valibot";

const configSchema = v.object({
  hash_secret: v.optional(v.string(), "dev-secret"),
});

const path = "./data/config.toml";
const raw = existsSync(path) ? Bun.TOML.parse(await Bun.file(path).text()) : {};

export const config = v.parse(configSchema, raw);
