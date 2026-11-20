import { defineHandler, getRouterParam } from "nitro/h3";
import { serveFile } from "../../files";
import { MODS_DIR } from "../../mods";

// the files of the Phigros++ mod catalog, under their own path so /mods stays the page: registry.txt and its .sig
// (mod/scripts/registry.sh), index.json and each mod's <owner>/<name>/poster.jpg and clip.mp4 (server/mods.ts)
export default defineHandler((event) =>
  serveFile(MODS_DIR, getRouterParam(event, "path") ?? "", event.req),
);
