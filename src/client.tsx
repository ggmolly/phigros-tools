import { StartClient } from "@tanstack/react-start/client";
import { StrictMode, startTransition } from "react";
import { hydrateRoot } from "react-dom/client";
import { setGame } from "./game";

// the game's data isn't bundled, so the updater changes it without a deploy (server/game.ts). the page names the
// version it was rendered with, which the root route preloads
const version = document.querySelector<HTMLMetaElement>('meta[name="game"]')!.content;
setGame(await (await fetch(`/game.json?v=${version}`)).json());

startTransition(() => {
  hydrateRoot(
    document,
    <StrictMode>
      <StartClient />
    </StrictMode>,
  );
});
