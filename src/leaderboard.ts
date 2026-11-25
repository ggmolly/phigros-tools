import { createServerFn } from "@tanstack/react-start";
import { getRequestHeader } from "@tanstack/react-start/server";
import { type PlayerRanking, ranking } from "./plays";

/**
 * One page of the players by RKS, searched by name or name#0042. The cookie goes along as admins see everyone: kept
 * out of src/plays.ts, which the worker imports and can't bundle `@tanstack/react-start/server`
 */
export const getPlayerRanking = createServerFn({ method: "GET" })
  .validator((search: { page: number; q: string; verified: boolean }) => search)
  .handler(({ data }) =>
    ranking<PlayerRanking>("/api/players", data.page, data.verified ? 1 : 0, data.q, {
      headers: { cookie: getRequestHeader("cookie") ?? "" },
    }),
  );
