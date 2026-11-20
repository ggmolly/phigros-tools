import { defineHandler, getRouterParam } from "nitro/h3";
import { serveFile } from "../../files";

// the Phigros++ custom chapters made by scripts/publish-charts.ts: <code>/index.json and its .sig, then each song's
// music, covers and .phc charts. kept in data/ so publishing needs no deploy
export default defineHandler((event) =>
  serveFile("./data/chapters", getRouterParam(event, "path") ?? "", event.req),
);
