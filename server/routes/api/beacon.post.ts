import { isbot, isbotMatch } from "isbot";
import { defineHandler } from "nitro/h3";
import { UAParser } from "ua-parser-js";
import * as v from "valibot";
import { countryOf, visitorOf } from "../../client";
import { db } from "../../db";
import { events } from "../../schema";

const noContent = () => new Response(null, { status: 204 });

const cut = (length: number) => v.transform((text: string) => text.slice(0, length));
const Beacon = v.object({
  path: v.pipe(v.string(), v.startsWith("/"), cut(512)),
  referrer: v.fallback(v.optional(v.pipe(v.string(), cut(255))), undefined),
});

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {}
  try {
    return new URL(`https://${value}`).hostname || null;
  } catch {}
  return null;
}

// a page was seen (see the events table in server/schema.ts). a visitor who asks not to be tracked isn't counted
export default defineHandler(async (event) => {
  const { headers } = event.req;
  if (headers.get("dnt") === "1" || headers.get("sec-gpc") === "1") return noContent();

  const ua = headers.get("user-agent") ?? "";
  const bot = !ua || isbot(ua);

  const beacon = v.safeParse(Beacon, await event.req.json().catch(() => null));
  if (!beacon.success) return new Response(null, { status: 400 });
  const { path, referrer } = beacon.output;

  const day = new Date().toISOString().slice(0, 10);
  const { browser, device } = UAParser(ua);
  await db.insert(events).values({
    ts: Date.now(),
    day,
    path,
    referrer_domain: referrer ? hostnameOf(referrer) : null,
    browser: browser.name ?? "Other",
    device: device.type ?? "desktop",
    is_bot: bot,
    visitor_hash: visitorOf(event.req, day),
    // only keep the UA of bots
    bot_ua: bot ? ua.slice(0, 512) : null,
    bot_match: bot && ua ? isbotMatch(ua) : null,
    country: countryOf(event.req),
  });
  return noContent();
});
