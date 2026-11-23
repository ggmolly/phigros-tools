import { readFileSync, realpathSync, statSync } from "node:fs";
import { type Game, game, setGame } from "../src/game";
import { log } from "./log";

/**
 * The game's data (src/game.ts): the JSON files the updater makes from the APK, and the covers, music, charts and
 * avatars the site serves from here (server/routes). The updater writes each version to a folder of its own and
 * points this link at it, so the server and the worker never read a half-written one.
 */
export const GAME_DIR = process.env.GAME_DIR ?? "./data/game";

const read = (file: string) => JSON.parse(readFileSync(`${GAME_DIR}/${file}`, "utf8"));
let loaded = "";
/** What the browser gets as /game.json, made once per version. */
export let gameJson = "";

/** Loads the game if its link (or, without the updater, its catalog) changed since the last time, says if it did. */
export function loadGame(): boolean {
  const seen = `${realpathSync(GAME_DIR)}:${statSync(`${GAME_DIR}/catalog.json`).mtimeMs}`;
  if (seen === loaded) return false;
  const browser = {
    catalog: read("catalog.json"),
    palettes: read("palettes.json"),
    avatars: read("avatars.json"),
    keys: read("keys.json"),
  };
  const version = Bun.hash(JSON.stringify(browser)).toString(36);
  gameJson = JSON.stringify({ version, ...browser });
  setGame({
    version,
    ...browser,
    accents: read("accents.json"),
    chartStats: read("chart-stats.json").songs,
  } satisfies Game);
  loaded = seen;
  log.info("game.loaded", { game: game().catalog.manifest.gameVersion, version });
  return true;
}

/** Follows the updater: runs `then` each time it brings another game. */
export const followGame = (then?: () => void) => setInterval(() => loadGame() && then?.(), 30_000);
