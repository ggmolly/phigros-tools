import { defineHandler, deleteCookie } from "nitro/h3";
import { SESSION } from "../../session";

// signing out forgets the cookie
export default defineHandler((event) => {
  deleteCookie(event, SESSION, { path: "/" });
  return { ok: true };
});
