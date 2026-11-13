import { createRouter } from "@tanstack/react-router";
import { type Locale, splitLocale, withLocale } from "./i18n/locales";
import { routeTree } from "./routeTree.gen";

/**
 * One router per request on the server, one per page load in the browser. The language prefix is taken off
 * every incoming URL (the routes never see it) and put back on every link, so `<Link to="/charts">` stays
 * in the reader's language.
 */
export function getRouter() {
  const i18n: { locale: Locale } = { locale: "en" };
  return createRouter({
    routeTree,
    context: { i18n },
    // a new page wipes in (styles/motion.css), a search or a filter changing the address doesn't
    defaultViewTransition: { types: ({ pathChanged }) => pathChanged && ["page"] },
    rewrite: {
      input: ({ url }) => {
        const { locale, path } = splitLocale(url.pathname);
        i18n.locale = locale;
        url.pathname = path;
        return url;
      },
      output: ({ url }) => {
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
