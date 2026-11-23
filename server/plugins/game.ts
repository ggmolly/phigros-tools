import { definePlugin } from "nitro";
import { followGame, loadGame } from "../game";

// the game's data before the first page renders, then each version the updater brings
export default definePlugin(() => {
  loadGame();
  followGame();
});
