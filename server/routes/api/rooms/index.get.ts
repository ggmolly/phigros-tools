import { defineHandler } from "nitro/h3";
import { openRooms } from "../../../rooms";

// the open rooms, for the site's list and the game's
export default defineHandler(openRooms);
