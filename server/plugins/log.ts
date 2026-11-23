import { randomBytes } from "node:crypto";
import { definePlugin } from "nitro";
import { getCookie, type H3Event } from "nitro/h3";
import { splitLocale } from "../../src/i18n/locales";
import { clientOf, countryOf } from "../client";
import { flush, log } from "../log";
import { SESSION, sessionClaim } from "../session";

// what's asked of the server, a line each (server/log.ts): which route, how it went and how long it took, who asked
// when they signed in, and never what they sent. files, the pages' own beacons and what a page asks the server
// while it renders are left out unless they fail

// a page's path with what names a player, a chart or a room taken out: /players/*, /charts/*/play/*
const pageOf = (pathname: string) =>
  splitLocale(pathname)
    .path.split("/")
    .map((part, at) => (at < 2 || part === "play" || part === "plays" ? part : "*"))
    .join("/");

const QUIET = /^\/api\/(beacon|errors)$/;

export default definePlugin((nitro) => {
  // h3 prints what a handler threw, values of a failed query included: the error hook below says it instead
  if (nitro.h3) nitro.h3.config.silent = true;

  nitro.hooks.hook("request", (event) => {
    const { context } = event as H3Event;
    context.rid = randomBytes(8).toString("hex");
    context.began = performance.now();
  });

  nitro.hooks.hook("response", (response, raw) => {
    const event = raw as H3Event;
    const { req, context } = event;
    const { status } = response;
    const { pathname } = new URL(req.url);
    const matched = context.matchedRoute?.route;
    const page = !matched || matched === "/**";
    const socket = req.headers.get("upgrade") === "websocket";
    const html = (response.headers.get("content-type") ?? "").startsWith("text/html");
    // a page's own requests to the server come without the runtime a real one has
    const inner = !req.runtime;
    const quiet =
      inner ||
      QUIET.test(pathname) ||
      (page && !html && !pathname.startsWith("/_serverFn/")) ||
      (page && status >= 300 && status < 400);
    if (quiet && status < (QUIET.test(pathname) ? 400 : 500)) return;
    const failed = status >= 500 && !(socket && status === 426);
    log[failed ? "error" : "info"]("http", {
      rid: context.rid,
      method: req.method,
      route: page ? pageOf(pathname) : matched,
      status,
      ms: Math.round(performance.now() - context.began!),
      bytes: Number(response.headers.get("content-length")) || undefined,
      player: context.player ?? sessionClaim(getCookie(event, SESSION))?.id,
      country: countryOf(req) ?? undefined,
      client: clientOf(req),
      ws: socket || undefined,
      inner: inner || undefined,
      ...context.log,
    });
  });

  // what a handler threw without meaning to. a refusal (4xx) only adds its code to the request's line
  nitro.hooks.hook("error", (error, { event, tags }) => {
    const status = (error as { status?: number }).status ?? 500;
    const context = (event as H3Event | undefined)?.context;
    if (status >= 500) return log.error("error", { rid: context?.rid, tags, error });
    const code = (error as { body?: { code?: unknown } }).body?.code;
    if (context && typeof code === "string") context.log = { ...context.log, code };
  });

  nitro.hooks.hook("close", flush);
  log.info("start");
});
