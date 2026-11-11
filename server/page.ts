import { getQuery, type H3Event } from "nitro/h3";

/** Where the request's ?page= (from 1) starts. */
export function pageOffset(event: H3Event, size: number): number {
  return (Math.max(1, Math.floor(Number(getQuery(event).page)) || 1) - 1) * size;
}

/** The leaderboard's scope from ?verified=1: verified replays only, otherwise all. */
export const scopeOf = (event: H3Event) => (getQuery(event).verified === "1" ? 1 : 0);
