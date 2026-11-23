import type { CatalogFile } from "./catalog";
import type { ChartStats } from "./chartStats";
import type { KeysFile } from "./unlocks";

/**
 * What the site knows of the game, made from its APK by the updater and kept in data/game/ (server/game.ts), so a
 * game update reaches the site without a deploy. The browser gets the same from /game.json before the page hydrates
 * (src/client.tsx), but what only the server reads.
 */
export interface Game {
  /** a hash of what the browser gets, which keys its cache */
  version: string;
  catalog: CatalogFile;
  palettes: Record<string, string[]>;
  avatars: Record<string, string>;
  keys: KeysFile;
  /** these two stay on the server */
  accents?: Record<string, string>;
  chartStats?: Record<string, (ChartStats | null)[]>;
}

// on globalThis: the server's routes and its page renderer are bundled apart, each with its own copy of this module
type Store = { game?: Game; listeners: ((game: Game) => void)[] };
const store = ((globalThis as { phigrosGame?: Store }).phigrosGame ??= { listeners: [] });

export const game = (): Game => store.game!;

/** Runs now if the game is known, then again each time it changes: for what a module derives from it. */
export function onGame(listener: (game: Game) => void) {
  store.listeners.push(listener);
  if (store.game) listener(store.game);
}

export function setGame(next: Game) {
  store.game = next;
  for (const listener of store.listeners) listener(next);
}
