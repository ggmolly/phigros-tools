import { createRouter } from "@tanstack/react-router";
import { PageError } from "./components/chrome";
import { type Locale, splitLocale, withLocale } from "./i18n/locales";
import { routeTree } from "./routeTree.gen";

/**
 * One router per request on the server, one per page load in the browser. The language prefix is taken off
 * every incoming URL (the routes never see it) and put back on every link, so `<Link to="/charts">` stays
 * in the reader's language.
 */
const docs = (url: URL) => url.hostname.startsWith("docs.");

export function getRouter() {
  const i18n: { locale: Locale } = { locale: "en" };
  return createRouter({
    routeTree,
    context: { i18n },
    defaultErrorComponent: PageError,
    // a new page wipes in (styles/motion.css), a search or a filter changing the address doesn't
    defaultViewTransition: { types: ({ pathChanged }) => pathChanged && ["page"] },
    rewrite: {
      input: ({ url }) => {
        // the docs' host (docs.phigros.tools, docs.localhost) shows the /docs pages from its root, in English
        if (docs(url)) {
          i18n.locale = "en";
          url.pathname = `/docs${url.pathname.replace(/\/$/, "")}`;
          return url;
        }
        const { locale, path } = splitLocale(url.pathname);
        i18n.locale = locale;
        url.pathname = path;
        return url;
      },
      output: ({ url }) => {
        if (docs(url) && /^\/docs(\/|$)/.test(url.pathname)) {
          url.pathname = url.pathname.slice(5) || "/";
          return url;
        }
        // any other page of the site is on its own host
        if (docs(url)) {
          url.host = url.host.slice(5);
          if (url.hostname !== "localhost") url.protocol = "https:";
        }
        url.pathname = withLocale(url.pathname, i18n.locale);
        return url;
      },
    },
  });
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>;
  }
  interface HistoryState {
    profile?: string;
  }
}
