import { answer, call, type Signer } from "./phigrospp";
import type { PlayerName } from "./plays";

/**
 * The friends of the Phigros++ profile a browser is signed in to (server/friends.ts): the same list as the game's,
 * through requests signed by the browser's key. `POST /api/friendships` lists them, `PUT` asks a player or accepts
 * their request, `DELETE` ends a friendship, declines a request or takes one back. Each answers the list as it is then.
 */

/** A friend, or a request to or from a player. Only a friend who shows online says so, and what they play. */
export interface Friendship {
  player: PlayerName;
  state: "friend" | "incoming" | "outgoing";
  online: boolean;
  /** The game's id of the song they play and its level. */
  playing: { id: string; level: string } | null;
}

const request = async (signer: Signer, method: string, player = "") =>
  answer<Friendship[]>(await call(signer, method, "/api/friendships", player));

export const listFriends = (signer: Signer) => request(signer, "POST");
/** `player` is an id, or a name#0042 as typed. */
export const addFriend = (signer: Signer, player: string) => request(signer, "PUT", player);
export const removeFriend = (signer: Signer, id: string) => request(signer, "DELETE", id);
