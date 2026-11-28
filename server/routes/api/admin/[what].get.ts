import { defineHandler, getQuery, getRouterParam, HTTPError } from "nitro/h3";
import { ASKED, allowed } from "../../../admin";

// what /admin asks for by name (ASKED in server/admin.ts), for admins only
export default defineHandler(async (event) => {
  await allowed(event);
  const what = getRouterParam(event, "what") as keyof typeof ASKED;
  if (!Object.hasOwn(ASKED, what)) throw HTTPError.status(404);
  return ASKED[what](getQuery(event));
});
