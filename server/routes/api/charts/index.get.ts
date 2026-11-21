import { defineHandler } from "nitro/h3";
import { boardOf } from "../../../page";
import { chartCounts } from "../../../replays";

export default defineHandler((event) => chartCounts(boardOf(event)));
