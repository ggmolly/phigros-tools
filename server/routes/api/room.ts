import { defineWebSocketHandler } from "nitro/h3";
import { closed, message, open } from "../../rooms";

// the socket Phigros++ plays in rooms through (server/rooms.ts)
export default defineWebSocketHandler({
  open,
  message: (peer, sent) => message(peer, sent.text()),
  close: closed,
});
