/** What a page can follow live (server/live.ts): one player, one chart's ranking, or the players' ranking. */
export const topics = {
  player: (id: string) => `player:${id}`,
  chart: (song: string, level: string) => `chart:${song}:${level}`,
  ranking: "ranking",
};

/** "save" with when the player's game uploaded it (ms), "change" for anything else a page shows. */
export type LiveEvent = "save" | "change";
