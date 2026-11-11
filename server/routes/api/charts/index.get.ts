import { defineHandler } from "nitro/h3";
import { scopeOf } from "../../../page";
import { chartCounts } from "../../../replays";

export default defineHandler((event) => chartCounts(scopeOf(event)));
