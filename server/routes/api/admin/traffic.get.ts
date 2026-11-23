import { defineHandler, getQuery } from "nitro/h3";
import { allowed, traffic } from "../../../admin";

// the pages seen over the last ?days= (90 at most, as long as they're kept), for /admin
export default defineHandler(async (event) => {
  await allowed(event);
  return traffic(Math.min(90, Math.max(1, Math.floor(Number(getQuery(event).days)) || 30)));
});
