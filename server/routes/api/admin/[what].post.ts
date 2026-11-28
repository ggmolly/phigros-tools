import { defineHandler, getRouterParam, HTTPError } from "nitro/h3";
import { allowed, DONE, did } from "../../../admin";

// what an admin does from /admin (DONE in server/admin.ts), with the text the request carries
export default defineHandler(async (event) => {
  const who = await allowed(event);
  const what = getRouterParam(event, "what") as keyof typeof DONE;
  if (!Object.hasOwn(DONE, what)) throw HTTPError.status(404);
  const text = (await event.req.text()).slice(0, 200);
  await DONE[what](text);
  did(who, what, text);
  return { ok: true };
});
