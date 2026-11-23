import { existsSync } from "node:fs";
import { defineHandler } from "nitro/h3";
import { serveFile } from "../files";
import { GAME_DIR } from "../game";

// the game's files at the paths the pages ask for. what data/game lacks falls through to public/, as the card's
// fonts that aren't the song titles'
const GAME_FILES = /^\/(covers|music|chart-data|avatars|fonts\/card)\/|^\/chart-similarity\.bin$/;

export default defineHandler((event) => {
  const { pathname } = new URL(event.req.url);
  if (event.req.method !== "GET" || !GAME_FILES.test(pathname)) return;
  const path = decodeURIComponent(pathname.slice(1));
  if (existsSync(`${GAME_DIR}/${path}`)) return serveFile(GAME_DIR, path, event.req);
});
