import { defineHandler, HTTPError, setCookie } from "nitro/h3";
import { signed } from "../../auth";
import { player } from "../../players";
import { SESSION, sessionValue } from "../../session";

// a browser signed in to a Phigros++ profile gets the cookie its pages render with, for a year
export default defineHandler(async (event) => {
  const { key, device } = await signed(event);
  const found = player(key);
  if (!found) throw HTTPError.status(403, "Not registered");
  setCookie(event, SESSION, sessionValue(found.id, device), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 365 * 86_400,
  });
  return { ok: true };
});
