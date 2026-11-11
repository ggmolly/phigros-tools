import { defineHandler } from "nitro/h3";
import { chartCounts } from "../../../replays";

export default defineHandler(() => chartCounts());
