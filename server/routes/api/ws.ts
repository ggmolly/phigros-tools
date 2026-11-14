import { defineWebSocketHandler } from "nitro/h3";
import * as v from "valibot";
import { consume, follow, leave } from "../../live";

const Topics = v.pipe(v.array(v.pipe(v.string(), v.maxLength(256))), v.maxLength(32));

// a page's live events: it sends the topics it follows as they change (src/topics.ts), and gets { topic, event, data }
export default defineWebSocketHandler({
  open: consume,
  message(peer, message) {
    try {
      follow(peer, v.parse(Topics, message.json()));
    } catch {
      peer.close(1003, "Not a list of topics");
    }
  },
  close: leave,
});
