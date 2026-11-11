import { existsSync, readFileSync } from "node:fs";
import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { REPLAY_DIR } from "../../../replays";

// an uploaded replay as the game sent it, signature included: anyone can check who played it
export default defineHandler((event) => {
  const id = getRouterParam(event, "id")!;
  const path = `${REPLAY_DIR}/${id}.pigeon`;
  if (!/^[0-9a-f]{64}$/.test(id) || !existsSync(path)) throw HTTPError.status(404);
  return new Response(readFileSync(path), {
    headers: {
      "content-type": "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
});
