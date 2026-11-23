import { defineHandler } from "nitro/h3";
import { befriend, changed } from "../../friends";

// asks a player (their id or name#0042, the body) to be a friend, or accepts their request
export default defineHandler((event) => changed(event, befriend));
