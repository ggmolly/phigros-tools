import { defineHandler, getCookie, redirect } from "nitro/h3";
import {
  isLocale,
  LOCALE_COOKIE,
  negotiateLocale,
  splitLocale,
  withLocale,
} from "../../src/i18n/locales";

/** Paths that are never pages: assets, server functions, API and image routes. */
const NOT_PAGES =
  /^\/(api|og|_serverFn|_build|assets|covers|avatars|fonts|chart-data|player)\/|\.[a-z0-9]+$/i;

/**
 * Pages in English live at bare paths, other languages under a prefix (see src/router.tsx). A bare page URL
 * redirects to the reader's language: the switcher's cookie if set, else Accept-Language. Crawlers send
 * neither, so they get English there and find the other languages through hreflang and the sitemap. The
 * answer depends on both headers, so caches are told so.
 */
export default defineHandler((event) => {
  const { pathname, search } = new URL(event.req.url);
  if (event.req.method !== "GET" || NOT_PAGES.test(pathname)) return;
  if (splitLocale(pathname).locale !== "en") return;
  event.res.headers.append("vary", "Accept-Language, Cookie");
  const chosen = getCookie(event, LOCALE_COOKIE);
  const locale = isLocale(chosen)
    ? chosen
    : negotiateLocale(event.req.headers.get("accept-language") ?? undefined);
  if (locale !== "en") return redirect(`${withLocale(pathname, locale)}${search}`, 302);
});
