import { defineHandler, getQuery } from "nitro/h3";
import { game } from "../../src/game";
import { gameJson } from "../game";

// what the browser knows of the game (src/client.tsx), kept for good once asked for by its version
export default defineHandler(
  (event) =>
    new Response(gameJson, {
      headers: {
        "content-type": "application/json",
        "cache-control":
          getQuery(event).v === game().version ? "public, max-age=31536000, immutable" : "no-cache",
      },
    }),
);
