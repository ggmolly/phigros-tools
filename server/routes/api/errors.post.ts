import { assertBodySize, defineHandler, getCookie } from "nitro/h3";
import { UAParser } from "ua-parser-js";
import * as v from "valibot";
import { clientOf, countryOf, visitorOf } from "../../client";
import { log } from "../../log";
import { SESSION, sessionClaim } from "../../session";

const cut = (length: number) =>
  v.pipe(
    v.string(),
    v.transform((text) => text.slice(0, length)),
  );
const Report = v.object({
  kind: v.picklist(["error", "promise", "render"]),
  message: cut(300),
  stack: cut(4000),
  path: cut(512),
});

const EACH = 10; // reports a minute from one visitor
const ALL = 300; // and from everyone
let counts = new Map<string, number>();
setInterval(() => {
  counts = new Map();
}, 60_000).unref();
const over = (who: string, most: number) => {
  counts.set(who, (counts.get(who) ?? 0) + 1);
  return counts.get(who)! > most;
};

// an error a page ran into (src/report.ts), for the log: what broke, on which page and build, in which browser.
// a page stuck in a loop of them is only heard a few times a minute
export default defineHandler(async (event) => {
  assertBodySize(event, 8192);
  const report = v.safeParse(Report, await event.req.json().catch(() => null));
  if (!report.success) return new Response(null, { status: 400 });
  const day = new Date().toISOString().slice(0, 10);
  if (clientOf(event.req) === "bot" || over(visitorOf(event.req, day), EACH) || over("", ALL))
    return new Response(null, { status: 204 });
  const { browser, device } = UAParser(event.req.headers.get("user-agent") ?? "");
  log.warn("client.error", {
    ...report.output,
    browser: browser.name,
    device: device.type ?? "desktop",
    country: countryOf(event.req) ?? undefined,
    player: sessionClaim(getCookie(event, SESSION))?.id,
  });
  return new Response(null, { status: 204 });
});
