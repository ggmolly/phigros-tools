import { createHmac } from "node:crypto";
import { isbot } from "isbot";
import { defineHandler } from "nitro/h3";
import { UAParser } from "ua-parser-js";
import { config } from "../../config";
import { insertEvent } from "../../db";

const noContent = () => new Response(null, { status: 204 });

function hostnameOf(value: string): string | null {
  try {
    return new URL(value).hostname || null;
  } catch {}
  try {
    return new URL(`https://${value}`).hostname || null;
  } catch {}
  return null;
}

export default defineHandler(async (event) => {
  if (event.req.headers.get("dnt") === "1") return noContent();

  const ua = event.req.headers.get("user-agent") ?? "";
  const bot = !ua || isbot(ua);

  const body = await event.req.json().catch(() => null);
  const path = typeof body?.path === "string" ? body.path.slice(0, 512) : null;
  if (!path?.startsWith("/")) return new Response(null, { status: 400 });
  const rawReferrer = typeof body?.referrer === "string" ? body.referrer.slice(0, 255) : null;
  const referrerDomain = rawReferrer ? hostnameOf(rawReferrer) : null;

  const ip = event.req.headers.get("cf-connecting-ip") ?? "";

  const day = new Date().toISOString().slice(0, 10);
  const visitorHash = createHmac("sha256", config.hash_secret)
    .update(`${day}:${ip}:${ua}`)
    .digest("hex")
    .slice(0, 16);

  const { browser, device } = UAParser(ua);
  insertEvent({
    ts: Date.now(),
    day,
    path,
    referrerDomain,
    browser: browser.name ?? "Other",
    device: device.type ?? "desktop",
    isBot: bot,
    visitorHash,
  });
  return noContent();
});
