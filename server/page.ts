import { getQuery, type H3Event } from "nitro/h3";

/** Where the request's ?page= (from 1) starts. */
export function pageOffset(event: H3Event, size: number): number {
  return (Math.max(1, Math.floor(Number(getQuery(event).page)) || 1) - 1) * size;
}
