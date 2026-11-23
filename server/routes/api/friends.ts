import { defineWebSocketHandler } from "nitro/h3";
import { closed, message, open } from "../../friends";

// the socket Phigros++ follows its player's friends through (server/friends.ts)
export default defineWebSocketHandler({
  open,
  message: (peer, sent) => message(peer, sent.text()),
  close: closed,
});
