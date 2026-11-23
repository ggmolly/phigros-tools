import { createHmac } from "node:crypto";
import { isbot } from "isbot";
import { config } from "./config";

// what a request tells of who sent it, without keeping who: the pages seen, the log and the errors pages report all
// read it here

/** The game (Unity names itself, and its sockets come from no page), a bot, or a browser. */
export function clientOf(request: Request) {
  const { headers } = request;
  const agent = headers.get("user-agent") ?? "";
  const socket = headers.get("upgrade") === "websocket" && !headers.has("origin");
  if (headers.has("x-unity-version") || agent.startsWith("UnityPlayer/") || socket) return "game";
  return !agent || isbot(agent) ? "bot" : "browser";
}

/** The country Cloudflare saw the request come from, null when it doesn't say. */
export function countryOf(request: Request) {
  const country = request.headers.get("cf-ipcountry") ?? "";
  return /^[A-Z]{2}$/.test(country) && country !== "XX" ? country : null;
}

/** Tells a day's visitors apart: it changes every day, and neither the address nor the user agent is kept. */
export function visitorOf(request: Request, day: string) {
  const address = request.headers.get("cf-connecting-ip") ?? "";
  return createHmac("sha256", config.hash_secret)
    .update(`${day}:${address}:${request.headers.get("user-agent") ?? ""}`)
    .digest("hex")
    .slice(0, 16);
}
