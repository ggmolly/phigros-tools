import { defineHandler, getRouterParam } from "nitro/h3";
import { serveFile } from "../../files";
import { IOS_DIR } from "../../ios";

// what the Phigros++ page patches the game's ipa with, kept by the worker (server/ios.ts)
export default defineHandler((event) =>
  serveFile(IOS_DIR, getRouterParam(event, "path") ?? "", event.req),
);
