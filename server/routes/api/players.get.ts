import { defineHandler, getQuery } from "nitro/h3";
import { PLAYS_PAGE } from "../../../src/plays";
import { pageOffset, scopeOf } from "../../page";
import { playerRanking } from "../../replays";

// one page of the players by RKS, ?q= searching them by name or name#number, ?verified=1 counting verified replays only
export default defineHandler((event) =>
  playerRanking(
    scopeOf(event),
    PLAYS_PAGE,
    pageOffset(event, PLAYS_PAGE),
    String(getQuery(event).q ?? "").slice(0, 64),
  ),
);
