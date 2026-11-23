import { defineHandler } from "nitro/h3";
import { changed, unfriend } from "../../friends";

// ends a friendship with a player (their id, the body), turns their request down or takes one back
export default defineHandler((event) => changed(event, unfriend));
