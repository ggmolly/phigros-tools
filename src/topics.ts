/**
 * What a page can follow live (server/live.ts): one player, one chart's ranking, the players' ranking, the open rooms
 * or one room.
 */
export const topics = {
  player: (id: string) => `player:${id}`,
  chart: (song: string, level: string) => `chart:${song}:${level}`,
  ranking: "ranking",
  rooms: "rooms",
  room: (id: string) => `room:${id}`,
};

/**
 * "save" with when the player's game uploaded it (ms), "room" with a room as it is now (a RoomView as JSON), "change"
 * for anything else a page shows.
 */
export type LiveEvent = "save" | "room" | "change";
