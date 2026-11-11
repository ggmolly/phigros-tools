import { defineHandler, getRouterParam } from "nitro/h3";
import { canonicalSongId } from "../../../../../src/catalog";
import { PLAYS_PAGE } from "../../../../../src/plays";
import { pageOffset } from "../../../../page";
import { chartPlays } from "../../../../replays";

// one page of a chart's players
export default defineHandler((event) =>
  chartPlays(
    canonicalSongId(getRouterParam(event, "id")!),
    getRouterParam(event, "level")!,
    PLAYS_PAGE,
    pageOffset(event, PLAYS_PAGE),
  ),
);
